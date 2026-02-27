import os
import base64
import modal
from typing import Union, List

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "transformers==5.1.0",
        "Pillow",
        "requests",
        "hf-transfer==0.1.9",
        "accelerate",
        "fastapi",
        "torchvision",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

app = modal.App("lightonocr", image=image)

model_volume = modal.Volume.from_name("ocr-model", create_if_missing=True)

MODEL_ID = "lightonai/LightOnOCR-2-1B"
VOLUME_MOUNT = "/vol"          # where volume is mounted
MODEL_DIR = "/vol/model"       # where model files live inside volume
GPU = "A10G"


@app.function(
    volumes={VOLUME_MOUNT: model_volume},
    image=image,
    timeout=600,
)
def download_model():
    from huggingface_hub import snapshot_download

    print(f"Volume contents: {os.listdir(VOLUME_MOUNT)}")

    if os.path.exists(f"{MODEL_DIR}/config.json"):
        print(f"Model already downloaded: {os.listdir(MODEL_DIR)}")
        return

    print(f"Downloading {MODEL_ID} → {MODEL_DIR}")
    snapshot_download(MODEL_ID, local_dir=MODEL_DIR)
    model_volume.commit()
    print(f"Done. Files: {os.listdir(MODEL_DIR)}")


@app.cls(
    gpu=GPU,
    volumes={VOLUME_MOUNT: model_volume},
    scaledown_window=180,
    timeout=180,
    secrets=[modal.Secret.from_name("ocr-secrets")],
)
@modal.concurrent(max_inputs=16)
class OCRServer:

    @modal.enter()
    def load(self):
        import torch
        from transformers import LightOnOcrForConditionalGeneration, LightOnOcrProcessor

        print(f"Loading model from {MODEL_DIR}")
        print(f"Files: {os.listdir(MODEL_DIR)}")

        self.device = "cuda"
        self.dtype = torch.bfloat16

        self.model = LightOnOcrForConditionalGeneration.from_pretrained(
            MODEL_DIR,
            torch_dtype=self.dtype,
            local_files_only=True,
        ).to(self.device)
        self.processor = LightOnOcrProcessor.from_pretrained(
            MODEL_DIR,
            local_files_only=True,
        )

        if self.processor.tokenizer.padding_side != "left":
            self.processor.tokenizer.padding_side = "left"

        # Warmup
        import numpy as np
        from PIL import Image

        dummy = Image.fromarray(np.ones((32, 32, 3), dtype=np.uint8))
        dummy_conv = [[{"role": "user", "content": [{"type": "image", "image": dummy}]}]]
        dummy_inputs = self.processor.apply_chat_template(
            dummy_conv,
            add_generation_prompt=True,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
            padding=True,
        )
        dummy_inputs = {
            k: v.to(device=self.device, dtype=self.dtype) if v.is_floating_point() else v.to(self.device)
            for k, v in dummy_inputs.items()
        }
        with torch.no_grad():
            self.model.generate(**dummy_inputs, max_new_tokens=4)

        self.model.eval()
        print("Model ready.")

    @modal.method()
    def ocr(self, image_or_images: Union[str, List[str]]) -> Union[str, List[str]]:
        import torch
        import io
        from PIL import Image

        is_batch = isinstance(image_or_images, list)
        images_b64 = image_or_images if is_batch else [image_or_images]

        images = [
            Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
            for b64 in images_b64
        ]
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

        prompt_len = inputs["input_ids"].shape[1]
        decoded = self.processor.batch_decode(
            output_ids[:, prompt_len:], skip_special_tokens=True
        )
        results = [t.strip() for t in decoded]
        return results if is_batch else results[0]

    @modal.asgi_app(label="api")
    def web(self):
        from fastapi import FastAPI, Header, HTTPException
        from fastapi.middleware.cors import CORSMiddleware

        web_app = FastAPI()
        web_app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )

        async def verify(x_api_key: str = Header(...)):
            if x_api_key != os.environ["OCR_API_KEY"]:
                raise HTTPException(status_code=401, detail="Invalid API key")

        @web_app.post("/ocr")
        async def ocr(data: dict, x_api_key: str = Header(...)):
            await verify(x_api_key)
            image = data.get("image")
            images = data.get("images")
            if not image and not images:
                raise HTTPException(status_code=400, detail="Missing 'image' or 'images'")
            result = await self.ocr.remote.aio(images if images else image)
            return {"texts": result} if isinstance(result, list) else {"text": result}

        @web_app.get("/health")
        async def health():
            return {"status": "ok", "model": MODEL_ID, "gpu": GPU}

        return web_app


@app.local_entrypoint()
def main():
    download_model.remote()

    import urllib.request
    url = "https://huggingface.co/datasets/hf-internal-testing/fixtures_ocr/resolve/main/SROIE-receipt.jpeg"
    with urllib.request.urlopen(url) as r:
        b64 = base64.b64encode(r.read()).decode()

    result = OCRServer().ocr.remote(b64)
    print(result)