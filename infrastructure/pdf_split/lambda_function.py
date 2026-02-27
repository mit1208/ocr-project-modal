import boto3
import urllib.parse
import urllib.request
import json
import time
import io
import os
from pypdf import PdfReader
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
    file_id = key.split('/')[-1]

    # Initialize Supabase
    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    supabase: Client = create_client(supabase_url, supabase_key)

    # 1. Look up the pre-created document record from Supabase.
    #    The /api/upload-url route pre-creates this record before
    #    returning the presigned URL, so it should exist by the time
    #    this Lambda runs.
    user_id = None
    case_id = None
    is_public = False
    filename = file_id

    try:
        doc_result = supabase.table('documents').select('*').eq('file_id', file_id).limit(1).execute()
        if doc_result.data and len(doc_result.data) > 0:
            doc = doc_result.data[0]
            user_id = doc.get('user_id')
            case_id = doc.get('case_id')
            is_public = doc.get('is_public', False)
            filename = doc.get('filename', file_id)
            print(f"✅ Found pre-created document record: user_id={user_id}, case_id={case_id}, is_public={is_public}")
        else:
            print(f"⚠️ No pre-created document record found for file_id={file_id}. Falling back to S3 metadata.")
            # Fallback: try to read from S3 metadata (legacy uploads)
            head = s3_client.head_object(Bucket=bucket, Key=key)
            metadata = {k.lower(): v for k, v in head.get('Metadata', {}).items()}
            print(f"DEBUG: S3 metadata fallback: {json.dumps(metadata)}")
            
            user_id = metadata.get('user-id') or metadata.get('user_id')
            case_id = metadata.get('case-id') or metadata.get('case_id')
            is_public_str = metadata.get('is-public') or metadata.get('is_public') or 'false'
            is_public = is_public_str.lower() == 'true'
            filename = metadata.get('filename', file_id)
            
            if not user_id or user_id == 'anonymous':
                print(f"❌ CRITICAL Error: Missing user_id in both Supabase and S3 metadata.")
                if not user_id: raise ValueError("Document metadata is missing user_id")
            
            # Create the document record since it doesn't exist
            doc_data = {
                "file_id": file_id,
                "filename": filename,
                "is_public": is_public,
                "case_id": case_id,
                "user_id": user_id
            }
            print(f"Attempting to upsert document record: {json.dumps(doc_data)}")
            try:
                res = supabase.table('documents').upsert(doc_data, on_conflict='file_id').execute()
                print(f"✅ Document upsert successful: {json.dumps(res.data)}")
            except Exception as e:
                print(f"❌ Failed to upsert document record for {file_id}: {e}")
                raise e
    except Exception as e:
        print(f"❌ Error looking up document: {e}")
        raise e

    # 2. Check for existing OCR results to prevent redundant processing (billing protection)
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
    
    chunk_size = 8  # Eight pages per invoke_ocr — each Lambda handles a batch of up to 8 images
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
        if user_id:
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
