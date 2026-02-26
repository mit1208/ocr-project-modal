import boto3
import urllib.parse
from pypdf import PdfReader
import io
import os
from supabase import create_client, Client

s3_client = boto3.client('s3')

def lambda_handler(event, context):
    """
    Called by Step Functions.
    Expects input to contain the S3 Bucket and Key (from EventBridge S3 event).
    Downloads the PDF, counts the pages, and returns an array of processing jobs.
    """
    # EventBridge payload structure
    bucket = event.get('detail', {}).get('bucket', {}).get('name')
    if not bucket:
        bucket = event.get('bucket')
        
    key = event.get('detail', {}).get('object', {}).get('key')
    if not key:
        key = event.get('key')
        
    if not bucket or not key:
        raise ValueError("Missing bucket or key in event.")
        
    key = urllib.parse.unquote_plus(key)
    
    # Get metadata from S3
    head = s3_client.head_object(Bucket=bucket, Key=key)
    metadata = head.get('Metadata', {})
    
    is_public = metadata.get('is-public', 'false').lower() == 'true'
    case_id = metadata.get('case-id')
    user_id = metadata.get('user-id')
    filename = metadata.get('filename', key.split('/')[-1])
    file_id = key.split('/')[-1]

    # Initialize Supabase
    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    supabase: Client = create_client(supabase_url, supabase_key)

    # 1. Initialize the document record in Supabase
    doc_data = {
        "file_id": file_id,
        "filename": filename,
        "is_public": is_public,
        "case_id": case_id,
        "user_id": user_id if user_id != 'anonymous' else None
    }
    
    try:
        supabase.table('documents').upsert(doc_data, on_conflict='file_id').execute()
    except Exception as e:
        print(f"⚠️ Failed to upsert document record: {e}")

    # 2. Check for existing OCR results to prevent redundant processing (billing protection)
    # If we already have results for this file_id, we should stop here.
    try:
        existing = supabase.table('ocr_results').select('id').eq('file_id', file_id).limit(1).execute()
        if existing.data and len(existing.data) > 0:
            print(f"⏩ File {file_id} already has OCR results. Skipping redundant processing.")
            return {
                "file_id": file_id,
                "already_processed": True,
                "total_pages": 0,
                "chunks": []
            }
    except Exception as e:
        print(f"⚠️ Failed to check for existing results: {e}")

    # 3. Count pages and create chunks
    response = s3_client.get_object(Bucket=bucket, Key=key)
    pdf_file = io.BytesIO(response['Body'].read())
    
    reader = PdfReader(pdf_file)
    total_pages = len(reader.pages)
    
    chunk_size = 5
    chunks = []
    
    for i in range(0, total_pages, chunk_size):
        start_page = i + 1
        end_page = min(i + chunk_size, total_pages)
        chunk_data = {
            "bucket": bucket,
            "key": key,
            "start_page": start_page,
            "end_page": end_page,
            "file_id": file_id,
            "is_public": is_public
        }
        if user_id and user_id != 'anonymous':
            chunk_data["user_id"] = user_id
        chunks.append(chunk_data)
        
    return {
        "file_id": file_id,
        "user_id": user_id,
        "case_id": case_id,
        "total_pages": total_pages,
        "chunks": chunks,
        "is_public": is_public,
        "already_processed": False
    }
