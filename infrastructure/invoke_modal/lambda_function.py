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
        
        for p_num in range(start_page, end_page + 1):
            # Check if within total pages bound
            if p_num > len(doc): break
            
            if p_num in existing_pages:
                text = existing_pages[p_num]
                print(f"Page {p_num}: Found in DB.")
            else:
                print(f"Page {p_num}: Calling Modal OCR...")
                page = doc.load_page(p_num - 1)
                pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                
                # Convert to PNG base64
                img_bytes = pix.tobytes("png")
                img_b64 = base64.b64encode(img_bytes).decode('utf-8')
                
                # Send to Modal API
                req_data = json.dumps({"image": img_b64}).encode('utf-8')
                req = urllib.request.Request(MODAL_API_URL, data=req_data, headers={"Content-Type": "application/json"})
                
                try:
                    with urllib.request.urlopen(req, timeout=300) as response:
                        res_body = json.loads(response.read().decode())
                        text = res_body.get('text', '')
                        
                        if supabase:
                            # Write to Supabase
                            row_data = {
                                "file_id": file_id,
                                "page": p_num,
                                "text": text
                            }
                            if user_id:
                                row_data["user_id"] = user_id
                                
                            supabase.table("ocr_results").insert(row_data).execute()
                except Exception as e:
                    print(f"Failed to process page {p_num}: {e}")
                    raise e
            
            results.append({"page": p_num, "text": text})
                
        return {"status": "success", "file_id": file_id, "results": results}
        
    except Exception as e:
        print(f"Error: {e}")
        raise e
