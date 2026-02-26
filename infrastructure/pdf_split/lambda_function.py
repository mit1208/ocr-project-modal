import boto3
import urllib.parse
from pypdf import PdfReader
import io

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
    
    # Extract user_id from key: uploads/{user_id}/{filename}
    parts = key.split('/')
    user_id = parts[1] if len(parts) > 2 else None
    
    # Get the file from S3 directly into memory to read the page count
    response = s3_client.get_object(Bucket=bucket, Key=key)
    pdf_file = io.BytesIO(response['Body'].read())
    
    reader = PdfReader(pdf_file)
    total_pages = len(reader.pages)
    
    chunk_size = 10
    chunks = []
    
    file_id = key.split('/')[-1]
    
    for i in range(0, total_pages, chunk_size):
        start_page = i + 1
        end_page = min(i + chunk_size, total_pages)
        chunk_data = {
            "bucket": bucket,
            "key": key,
            "start_page": start_page,
            "end_page": end_page,
            "file_id": file_id
        }
        if user_id:
            chunk_data["user_id"] = user_id
        chunks.append(chunk_data)
        
    return {
        "file_id": file_id,
        "user_id": user_id,
        "total_pages": total_pages,
        "chunks": chunks
    }
