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
        self.model.eval()
        print("Model ready.")

    @modal.method()
    def ocr(self, image_b64: str) -> str:
        import torch
        import io
        from PIL import Image

        image_bytes = base64.b64decode(image_b64)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        conversation = [{"role": "user", "content": [{"type": "image", "image": image}]}]

        inputs = self.processor.apply_chat_template(
            conversation,
            add_generation_prompt=True,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
        )
        inputs = {
            k: v.to(device=self.device, dtype=self.dtype) if v.is_floating_point() else v.to(self.device)
            for k, v in inputs.items()
        }

        with torch.no_grad():
            output_ids = self.model.generate(**inputs, max_new_tokens=4096)

        generated_ids = output_ids[0, inputs["input_ids"].shape[1]:]
        return self.processor.decode(generated_ids, skip_special_tokens=True).strip()

    @modal.fastapi_endpoint(method="POST", docs=True)
    def api(self, request: dict):
        from fastapi.responses import JSONResponse
        """POST body: { "image": "<base64>" } — returns { "text": "..." }"""
        headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        }
        image_b64 = request.get("image")
        if not image_b64:
            return JSONResponse(content={"error": "Missing 'image' field"}, status_code=400, headers=headers)
        return JSONResponse(content={"text": self.ocr.local(image_b64)}, headers=headers)

    @modal.fastapi_endpoint(method="OPTIONS")
    def api_options(self):
        from fastapi.responses import Response
        headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        }
        return Response(status_code=204, headers=headers)

    @modal.fastapi_endpoint(method="GET")
    def health(self) -> dict:
        return {"status": "ok", "model": MODEL_ID, "gpu": GPU}


@app.local_entrypoint()
def main():
    import urllib.request

    url = "https://huggingface.co/datasets/hf-internal-testing/fixtures_ocr/resolve/main/SROIE-receipt.jpeg"
    with urllib.request.urlopen(url) as r:
        image_bytes = r.read()

    image_b64 = base64.b64encode(image_bytes).decode()
    print("Sending test image ...")
    result = OCRServer().ocr.remote(image_b64)
    print("\n--- OCR Result ---")
    print(result)