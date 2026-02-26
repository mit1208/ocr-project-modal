import os
# Trigger refresh for layer optimization
import json
import google.generativeai as genai
from supabase import create_client, Client

def lambda_handler(event, context):
    print("🚀 Starting Embedding Generation Lambda...")
    
    print(f"Event received: {json.dumps(event)}")
    
    # If event is a list (Map state output), take the first item as context if it has one
    if isinstance(event, list):
        event = event[0] if len(event) > 0 else {}

    file_id = event.get('file_id')
    user_id = event.get('user_id')
    
    # Check if it's nested (Sfn results path)
    if not file_id:
        file_id = event.get('pageSplitResult', {}).get('file_id')
    if not user_id:
        user_id = event.get('pageSplitResult', {}).get('user_id')
        
    # Check analysisResult if present
    if not file_id:
        file_id = event.get('analysisResult', {}).get('file_id')
    if not user_id:
        user_id = event.get('analysisResult', {}).get('user_id')
    
    if not file_id:
        print(f"CRITICAL: Could not find file_id in event key set: {list(event.keys())}")
        raise ValueError("Missing file_id in event payload")

    SUPABASE_URL = os.environ.get('SUPABASE_URL')
    SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')

    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    genai.configure(api_key=GEMINI_API_KEY)
    
    # 1. Fetch all OCR text for this file
    print(f"Fetching OCR results for file_id: {file_id}")
    response = supabase.table("ocr_results").select("page, text").eq("file_id", file_id).order("page").execute()
    
    if not response.data:
        print("No OCR text found. Embedding skipped.")
        return {"status": "error", "message": "No OCR text found"}

    # 2. Process and Chunk Text
    chunks_to_insert = []
    
    for row in response.data:
        page_text = row['text']
        page_num = row['page']
        
        # Simple chunking: split by paragraph or length
        # For medical docs, page-level or block-level is often better for RAG
        # We'll do simple 1000 char chunks with overlap if page is large
        chunk_size = 2000
        overlap = 200
        
        for i in range(0, len(page_text), chunk_size - overlap):
            chunk_content = page_text[i : i + chunk_size]
            if len(chunk_content.strip()) < 50: continue # Skip tiny chunks
            
            try:
                # 3. Generate Embedding
                embedding_res = genai.embed_content(
                    model='models/gemini-embedding-001',
                    content=chunk_content,
                    task_type="RETRIEVAL_DOCUMENT",
                    output_dimensionality=768
                )
                vector = embedding_res['embedding']
                
                chunks_to_insert.append({
                    "file_id": file_id,
                    "user_id": user_id,
                    "page_number": page_num,
                    "chunk_index": len(chunks_to_insert),
                    "start_offset": i + 1, # Postgres substring is 1-indexed
                    "end_offset": i + len(chunk_content) + 1,
                    "embedding": vector
                })
            except Exception as e:
                print(f"Embedding failed for a chunk on page {page_num}: {e}")

    # 4. Batch insert into Supabase
    if chunks_to_insert:
        print(f"Inserting {len(chunks_to_insert)} chunks into vector store...")
        # Break into batches of 100 to avoid request size limits
        for i in range(0, len(chunks_to_insert), 100):
            batch = chunks_to_insert[i : i + 100]
            supabase.table("document_chunks").insert(batch).execute()
        
        return {"status": "success", "file_id": file_id, "chunks_count": len(chunks_to_insert)}
    
    return {"status": "error", "message": "No chunks generated"}
