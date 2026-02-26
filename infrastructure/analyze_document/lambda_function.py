import os
# Trigger refresh for layer optimization
import json
import google.generativeai as genai
from supabase import create_client, Client

def lambda_handler(event, context):
    print("🚀 Starting AI Analysis Lambda...")
    
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
    
    if not file_id:
        print(f"CRITICAL: Could not find file_id in event key set: {list(event.keys())}")
        raise ValueError("Missing file_id in event payload")

    SUPABASE_URL = os.environ.get('SUPABASE_URL')
    SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')

    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    genai.configure(api_key=GEMINI_API_KEY)
    
    # 1. Fetch all OCR text for this file
    print(f"Fetching text for file_id: {file_id}")
    response = supabase.table("ocr_results").select("page, text").eq("file_id", file_id).order("page").execute()
    
    if not response.data:
        print("No OCR text found. Analysis skipped.")
        return {"status": "error", "message": "No OCR text found"}

    # Include explicit page markers so the AI doesn't hallucinate page numbers
    full_text = ""
    for r in response.data:
        p_num = r['page']
        full_text += f"<page_{p_num}>\n{r['text']}\n</page_{p_num}>\n"
        
    print(f"Total characters to analyze: {len(full_text)}")

    # 2. Call Gemini
    model = genai.GenerativeModel('gemini-2.0-flash') # Latest flash model
    
    system_prompt = """You are a medical AI analyzer. Provide a full clinical intelligence report in JSON format.
    Use the provided <page_X>...</page_X> tags to accurately determine and reference the page number for every finding, event, and group item.
    
    Response Schema:
    {
        "document_type": "string",
        "clinical_summary": "narrative summary",
        "patients": [{ "patient_name": "string", "date_of_birth": "string", "facility": "string", "provider": "string", "summary": "string", "chief_complaint": "string", "follow_up": "string", "pages": [1] }],
        "critical_flags": [{ "flag": "string", "page": 1, "severity": "CRITICAL" }],
        "abnormal_findings": [{ "finding": "string", "value": "string", "reference": "string", "page": 1, "severity": "HIGH" }],
        "timeline": [{ "date": "string", "event": "string", "page": 1, "category": "visit|test|procedure" }],
        "groups": [{ "title": "group name", "items": [{"label": "string", "value": "string", "page": 1, "status": "normal|abnormal", "reference": "string"}] }]
    }"""

    prompt = f"{system_prompt}\n\nClinical Text:\n{full_text}"
    
    try:
        response_ai = model.generate_content(prompt)
        report_text = response_ai.text
        # Clean JSON
        report_text = report_text.replace("```json", "").replace("```", "").strip()
        report = json.loads(report_text)
        
        # 3. Save to Supabase ai_analysis table
        print(f"Saving analysis to DB for file_id: {file_id}")
        supabase.table("ai_analysis").upsert({
            "file_id": file_id,
            "user_id": user_id,
            "document_type": report.get("document_type"),
            "clinical_summary": report.get("clinical_summary"),
            "patients": report.get("patients"),
            "critical_flags": report.get("critical_flags"),
            "abnormal_findings": report.get("abnormal_findings"),
            "timeline": report.get("timeline"),
            "groups": report.get("groups"),
            "is_complete": True
        }).execute()
        
        return {"status": "success", "file_id": file_id, "user_id": user_id}
        
    except Exception as e:
        print(f"AI Analysis Failed: {e}")
        return {"status": "error", "message": str(e)}
