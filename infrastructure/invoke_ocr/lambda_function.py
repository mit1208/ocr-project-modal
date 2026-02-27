import base64
import json
import os
import requests

import boto3
import fitz  # PyMuPDF
from supabase import create_client, Client

s3_client = boto3.client("s3")

# Modal configuration
MODAL_API_URL = os.environ.get("MODAL_API_URL")
OCR_KEY = os.environ.get("OCR_API_KEY")

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# DPI for page rendering — 200 gives good accuracy without bloating payload size
RENDER_DPI = 200


def render_page_jpeg(pdf_path: str, page_number: int) -> bytes:
    """Opens a local PDF, renders the given 1-based page at RENDER_DPI, and returns JPEG bytes."""
    doc = fitz.open(pdf_path)
    if page_number < 1 or page_number > len(doc):
        raise ValueError(f"Page {page_number} out of range (document has {len(doc)} pages)")
    page = doc.load_page(page_number - 1)
    matrix = fitz.Matrix(RENDER_DPI / 72, RENDER_DPI / 72)
    pix = page.get_pixmap(matrix=matrix)
    return pix.tobytes("jpeg")


def call_modal_ocr_batch(images_b64: list[str]) -> list[str]:
    """
    POSTs multiple base64-encoded JPEGs to the Modal /ocr endpoint.
    Blocks until Modal returns the texts. Raises on any error.
    """
    url = MODAL_API_URL if MODAL_API_URL.endswith("/ocr") else f"{MODAL_API_URL.rstrip('/')}/ocr"
    
    payload = {"images": images_b64}
    headers = {
        "Content-Type": "application/json",
        "x-api-key": OCR_KEY
    }

    print(f"Calling Modal OCR at {url} with {len(images_b64)} images...")
    resp = requests.post(url, json=payload, headers=headers, timeout=180)
    resp.raise_for_status()
    
    body = resp.json()
    texts = body.get("texts")
    
    if texts is None:
        # Fallback for single image case if API returns {"text": "..."}
        single_text = body.get("text")
        if single_text:
            return [single_text]
        raise RuntimeError(f"Modal returned no 'texts' or 'text' field: {body}")
        
    return texts


def lambda_handler(event, context):
    bucket     = event.get("bucket")
    key        = event.get("key")
    start_page = event.get("start_page")
    end_page   = event.get("end_page")
    file_id    = event.get("file_id")
    user_id    = event.get("user_id")

    print(f"Processing chunk pages {start_page}–{end_page} for file_id={file_id}")

    # ── Supabase client (optional — skip DB steps if env vars are absent) ────
    supabase: Client = (
        create_client(SUPABASE_URL, SUPABASE_KEY)
        if SUPABASE_URL and SUPABASE_KEY
        else None
    )

    # ── 1. Check which pages are already in the DB ───────────────────────────
    existing_pages: dict[int, str] = {}
    if supabase:
        print("Checking DB for existing results...")
        db_res = (
            supabase.table("ocr_results")
            .select("page, text")
            .eq("file_id", file_id)
            .gte("page", start_page)
            .lte("page", end_page)
            .execute()
        )
        for row in db_res.data:
            existing_pages[row["page"]] = row["text"]

    missing_pages = [p for p in range(start_page, end_page + 1) if p not in existing_pages]

    if not missing_pages:
        page_numbers = list(range(start_page, end_page + 1))
        print(f"All pages in chunk already in DB — skipping OCR. Pages: {page_numbers}")
        return {
            "status": "success", 
            "file_id": file_id, 
            "user_id": user_id,
            "pages": page_numbers
        }

    # ── 2. Download PDF once to /tmp ─────────────────────────────────────────
    safe_key = file_id.replace("/", "_")
    temp_pdf_path = f"/tmp/{safe_key}.pdf"
    if not os.path.exists(temp_pdf_path):
        print(f"Downloading s3://{bucket}/{key} → {temp_pdf_path} ...")
        s3_client.download_file(bucket, key, temp_pdf_path)
        print("Download complete.")

    # ── 3. OCR all missing pages in this chunk ───────────────────────────────
    results: list[dict] = []
    rows_to_insert: list[dict] = []

    if missing_pages:
        try:
            batch_images_b64 = []
            for p_num in missing_pages:
                print(f"Rendering page {p_num} at {RENDER_DPI} DPI...")
                img_bytes = render_page_jpeg(temp_pdf_path, p_num)
                img_b64 = base64.b64encode(img_bytes).decode("utf-8")
                batch_images_b64.append(img_b64)

            # OCR this entire chunk in one go
            batch_texts = call_modal_ocr_batch(batch_images_b64)

            for p_num, text in zip(missing_pages, batch_texts):
                print(f"OCR complete for page {p_num} ({len(text)} chars).")
                results.append({"page": p_num, "text": text})

                row = {"file_id": file_id, "page": p_num, "text": text}
                if user_id:
                    row["user_id"] = user_id
                rows_to_insert.append(row)

        except Exception as err:
            print(f"Failed to process pages {missing_pages}: {err}")
            for p_num in missing_pages:
                results.append({"page": p_num, "text": ""})


    # ── 4. Persist new results to Supabase ───────────────────────────────────
    # Ensure user_id is a valid UUID (or None) to avoid DB syntax errors
    db_user_id = user_id if (user_id and user_id != 'anonymous') else None
    
    if supabase and rows_to_insert:
        for row in rows_to_insert:
            row["user_id"] = db_user_id
            
        print(f"Inserting {len(rows_to_insert)} row(s) into ocr_results for file_id={file_id}...")
        try:
            res = supabase.table("ocr_results").insert(rows_to_insert).execute()
            print(f"✅ Successfully inserted {len(rows_to_insert)} row(s).")
        except Exception as e:
            print(f"❌ Failed to insert OCR results for {file_id}: {e}")
            if "sync_is_public_status" in str(e):
                print("TIP: This error often happens if the 'documents' table entry for this file_id is missing.")

    # ── 5. Merge with pages that were already in DB, sort, return ────────────
    for p, t in existing_pages.items():
        results.append({"page": p, "text": t})

    # Sort results by page number for clean logging
    results.sort(key=lambda x: x["page"])
    page_numbers = [r["page"] for r in results]
    print(f"Chunk done. Processed pages: {page_numbers}")
    
    return {
        "status": "success", 
        "file_id": file_id, 
        "user_id": user_id, 
        "pages": page_numbers
    }
