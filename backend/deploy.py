"""
LightOnOCR-2-1B — Modal + HuggingFace Transformers
Deploy:  modal deploy deploy.py
Test:    modal run deploy.py
"""

import base64
import modal

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "transformers==5.1.0",
        "Pillow",
        "requests",
        "hf-transfer==0.1.9",
        "accelerate",
        "fastapi",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

from typing import Union, List

app = modal.App("lightonocr", image=image)

hf_cache = modal.Volume.from_name("hf-cache", create_if_missing=True)

MODEL_ID = "lightonai/LightOnOCR-2-1B"
GPU = "A10G"


@app.cls(
    gpu=GPU,
    volumes={"/root/.cache/huggingface": hf_cache},
    scaledown_window=60,
    timeout=300,
)
@modal.concurrent(max_inputs=4)
class OCRServer:
    @modal.enter()
    def load(self):
        import torch
        from transformers import LightOnOcrForConditionalGeneration, LightOnOcrProcessor

        print(f"Loading {MODEL_ID} ...")
        self.device = "cuda"
        self.dtype = torch.bfloat16

        self.model = LightOnOcrForConditionalGeneration.from_pretrained(
            MODEL_ID, torch_dtype=self.dtype
        ).to(self.device)
        self.processor = LightOnOcrProcessor.from_pretrained(MODEL_ID)
        
        # Ensure left padding for batch generation
        if self.processor.tokenizer.padding_side != "left":
            self.processor.tokenizer.padding_side = "left"
            
        self.model.eval()
        print("Model ready.")

    @modal.method()
    def ocr(self, image_or_images: Union[str, List[str]]) -> Union[str, List[str]]:
        import torch
        import io
        from PIL import Image

        is_batch = isinstance(image_or_images, list)
        images_b64 = image_or_images if is_batch else [image_or_images]
        
        images = []
        for b64 in images_b64:
            image_bytes = base64.b64decode(b64)
            images.append(Image.open(io.BytesIO(image_bytes)).convert("RGB"))

        conversations = [
            [{"role": "user", "content": [{"type": "image", "image": img}]}] 
            for img in images
        ]

        inputs = self.processor.apply_chat_template(
            conversations,
            add_generation_prompt=True,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
            padding=True,
        )
        inputs = {
            k: v.to(device=self.device, dtype=self.dtype) if v.is_floating_point() else v.to(self.device)
            for k, v in inputs.items()
        }

        with torch.no_grad():
            output_ids = self.model.generate(**inputs, max_new_tokens=4096)

        # Skip the prompt tokens in the output
        prompt_len = inputs["input_ids"].shape[1]
        generated_ids = output_ids[:, prompt_len:]
        
        decoded_out = self.processor.batch_decode(generated_ids, skip_special_tokens=True)
        results = [text.strip() for text in decoded_out]
        
        return results if is_batch else results[0]

    @modal.asgi_app(label="api")
    def web(self):
        from fastapi import FastAPI, Request
        from fastapi.responses import JSONResponse
        from fastapi.middleware.cors import CORSMiddleware
        from modal.functions import FunctionCall
        import modal

        web_app = FastAPI()

        web_app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )

        @web_app.post("/api")
        async def start_job(data: dict):
            """Enqueues a job and returns job_id."""
            images = data.get("images")
            image = data.get("image")
            
            if not images and not image:
                return JSONResponse(content={"error": "Missing 'image' or 'images'"}, status_code=400)
            
            payload = images if images else image
            call = self.ocr.spawn(payload)
            print(f"Started async job: {call.object_id}")
            return {"job_id": call.object_id}

        @web_app.get("/results")
        async def get_results(job_id: str):
            """Polls for job completion."""
            try:
                call = FunctionCall.from_id(job_id)
                try:
                    result = call.get(timeout=0)
                    if isinstance(result, list):
                        return {"status": "completed", "texts": result}
                    else:
                        return {"status": "completed", "text": result}
                except modal.exception.TimeoutError:
                    return {"status": "processing"}
                except Exception as e:
                    return {"status": "failed", "error": str(e)}
            except Exception as e:
                return JSONResponse(content={"status": "error", "error": str(e)}, status_code=500)

        @web_app.get("/health")
        async def health():
            return {"status": "ok", "model": MODEL_ID, "gpu": GPU}

        return web_app




@app.local_entrypoint()
def main():
    import urllib.request

    url = "https://huggingface.co/datasets/hf-internal-testing/fixtures_ocr/resolve/main/SROIE-receipt.jpeg"
    with urllib.request.urlopen(url) as r:
        image_bytes = r.read()

    image_b64 = base64.b64encode(image_bytes).decode()
    
    # Test single image
    print("Testing single image ...")
    result = OCRServer().ocr.remote(image_b64)
    print(f"\n--- Result (length {len(result)}) ---")
    print(result[:100] + "...")

    # Test batch images
    print("\nTesting batch (2 images) ...")
    batch_results = OCRServer().ocr.remote([image_b64, image_b64])
    print(f"Received {len(batch_results)} results.")
    for i, res in enumerate(batch_results):
        print(f"Result {i+1} (length {len(res)}): {res[:50]}...")