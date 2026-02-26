import boto3
import json
import base64
import os
import urllib.request
import urllib.error
import fitz
from supabase import create_client, Client

s3_client = boto3.client('s3')
MODAL_API_URL = os.environ.get('MODAL_API_URL')
SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

def lambda_handler(event, context):
    try:
        bucket = event.get('bucket')
        key = event.get('key')
        start_page = event.get('start_page')
        end_page = event.get('end_page')
        file_id = event.get('file_id')
        user_id = event.get('user_id')

        print(f"Processing chunk {start_page}-{end_page} for file {file_id}")
        
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None
        
        # 1. Check for existing pages in this range to avoid double-spend on Modal
        existing_pages = {}
        if supabase:
            print(f"Checking DB for existing results...")
            db_res = supabase.table("ocr_results") \
                .select("page, text") \
                .eq("file_id", file_id) \
                .gte("page", start_page) \
                .lte("page", end_page) \
                .execute()
            
            for row in db_res.data:
                existing_pages[row['page']] = row['text']
        
        results = []
        missing_pages = [p for p in range(start_page, end_page + 1) if p not in existing_pages]
        
        if not missing_pages:
            print("All pages in chunk found in DB. Skipping processing.")
            for p in range(start_page, end_page + 1):
                results.append({"page": p, "text": existing_pages[p]})
            return {"status": "success", "file_id": file_id, "results": results}

        # 2. If any pages are missing, we need the PDF
        temp_pdf_path = f"/tmp/{context.aws_request_id}.pdf"
        print(f"Downloading PDF from S3 for missing pages: {missing_pages}")
        s3_client.download_file(bucket, key, temp_pdf_path)
        doc = fitz.open(temp_pdf_path)
        
        pages_to_ocr = []
        images_to_ocr = []
        
        for p_num in range(start_page, end_page + 1):
            if p_num > len(doc): break
            
            if p_num in existing_pages:
                print(f"Page {p_num}: Found in DB.")
                results.append({"page": p_num, "text": existing_pages[p_num]})
            else:
                print(f"Page {p_num}: Preparing for batch OCR...")
                page = doc.load_page(p_num - 1)
                pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                img_bytes = pix.tobytes("png")
                img_b64 = base64.b64encode(img_bytes).decode('utf-8')
                
                pages_to_ocr.append(p_num)
                images_to_ocr.append(img_b64)

        if images_to_ocr:
            import time
            print(f"Starting async Modal OCR for batch of {len(images_to_ocr)} pages...")
            
            # Ensure URL format
            base_url = MODAL_API_URL.rstrip('/')
            if base_url.endswith('/api'): # Clean up if old URL was passed
                base_url = base_url[:-4]
            
            start_url = f"{base_url}/api"
            req_data = json.dumps({"images": images_to_ocr}).encode('utf-8')
            start_req = urllib.request.Request(start_url, data=req_data, headers={"Content-Type": "application/json"})
            
            try:
                with urllib.request.urlopen(start_req, timeout=30) as start_res:
                    res_json = json.loads(start_res.read().decode())
                    job_id = res_json.get('job_id')
                    
                if not job_id:
                    raise ValueError(f"Failed to get job_id from Modal. Response: {res_json}")
                
                print(f"Job started: {job_id}. Polling for results...")
                
                # Polling loop
                results_url = f"{base_url}/results?job_id={job_id}"
                max_polls = 60 # 2 minutes total
                texts = None
                
                for poll_count in range(max_polls):
                    try:
                        with urllib.request.urlopen(results_url, timeout=10) as poll_res:
                            poll_data = json.loads(poll_res.read().decode())
                            status = poll_data.get('status')
                            
                            if status == 'completed':
                                texts = poll_data.get('texts', [])
                                print(f"Job {job_id} completed successfully.")
                                break
                            elif status == 'failed':
                                raise Exception(f"Modal job failed: {poll_data.get('error')}")
                            
                            if poll_count % 5 == 0:
                                print(f"Polling... current status: {status}")
                    except Exception as poll_err:
                        print(f"Poll error: {poll_err}")
                        
                    time.sleep(2)
                
                if texts is None:
                    raise TimeoutError(f"Modal job {job_id} timed out after {max_polls * 2} seconds.")

                if len(texts) != len(pages_to_ocr):
                    print(f"Warning: Expected {len(pages_to_ocr)} results, but got {len(texts)}. Mapping might be misaligned.")

                rows_to_insert = []
                for i, p_num in enumerate(pages_to_ocr):
                    text = texts[i] if i < len(texts) else ""
                    results.append({"page": p_num, "text": text})
                    
                    row_data = {
                        "file_id": file_id,
                        "page": p_num,
                        "text": text
                    }
                    if user_id:
                        row_data["user_id"] = user_id
                    rows_to_insert.append(row_data)
                
                if supabase and rows_to_insert:
                    print(f"Inserting {len(rows_to_insert)} results into DB...")
                    supabase.table("ocr_results").insert(rows_to_insert).execute()
                        
            except Exception as e:
                print(f"Async OCR flow failed: {e}")
                raise e
        
        # Sort results by page number before returning
        results.sort(key=lambda x: x['page'])
        return {"status": "success", "file_id": file_id, "results": results}
        
    except Exception as e:
        print(f"Error: {e}")
        raise e
