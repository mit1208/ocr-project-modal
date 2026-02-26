# LightOnOCR-2-1B — Modal + vLLM Deployment

Serverless GPU OCR API. Scales to zero. **$0/month** on Modal's free tier for demo usage.

## Files

```
.
├── deploy.py        # Modal + vLLM server (deploy this)
├── demo.html        # Browser demo UI (open locally)
└── requirements.txt # Just: modal
```

---

## Setup (5 minutes)

### 1. Install Modal
```bash
pip install modal
modal setup   # opens browser to authenticate
```

### 2. Pre-download model weights (once)
```bash
modal run deploy.py::download_model
```
This downloads ~1.5GB into a Modal Volume. Only happens once — cached forever.

### 3. Deploy
```bash
modal deploy deploy.py
```

You'll see output like:
```
✓ Created web endpoint => https://mitbpatel0128--lightonocr-ocrserver-api.modal.run
```

**Copy that URL.**

### 4. Test via CLI
```bash
modal run deploy.py
```
Sends a sample receipt image and prints extracted text.

### 5. Open the demo UI
Open `demo.html` in your browser, paste the endpoint URL, upload an image, click Run.

---

## API

### `POST /api`
```bash
IMAGE_B64=$(base64 -w 0 document.png)

curl -X POST https://yourname--lightonocr-ocrserver-api.modal.run \
  -H "Content-Type: application/json" \
  -d "{\"image\": \"$IMAGE_B64\"}"
```
```json
{ "text": "Extracted text from document..." }
```

### `GET /health`
```bash
curl https://yourname--lightonocr-ocrserver-health.modal.run
```
```json
{ "status": "ok", "model": "lightonai/LightOnOCR-2-1B", "gpu": "A10G" }
```

---

## Cost

| Usage | Monthly cost |
|---|---|
| Light demo (< ~100k pages) | **$0** (within $30 free credit) |
| 500 pages/day | ~$5–15 |
| Scale-to-zero when idle | ✅ yes |

`scaledown_window=60` means the GPU releases after 60s of no requests — you pay nothing while idle.

---

## Configuration

In `deploy.py`:

| Variable | Default | Notes |
|---|---|---|
| `GPU` | `A10G` | Change to `T4` for lower cost, `A100` for speed |
| `scaledown_window` | `60` | Seconds idle before scaling to zero |
| `allow_concurrent_inputs` | `4` | Requests batched per worker |
