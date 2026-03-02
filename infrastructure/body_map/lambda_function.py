import os
import json
import traceback
import google.generativeai as genai
from supabase import create_client, Client

# Environment configuration
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

# Initialize Gemini and Supabase optionally outside for reuse
genai.configure(api_key=GEMINI_API_KEY)
# We use gemini-1.5-pro or flash depending on preference. Using flash-lite is faster if available, but let's use gemini-1.5-flash as default, or whatever the codebase uses.
GEMINI_MODEL = "gemini-2.5-flash-lite"
model = genai.GenerativeModel(GEMINI_MODEL)

def build_cors_response(status_code: int, body: dict):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "OPTIONS,GET",
            "Access-Control-Allow-Headers": "Content-Type",
        },
        "body": json.dumps(body)
    }

def lambda_handler(event, context):
    print(f"Event: {json.dumps(event)}")
    
    # Handle CORS Preflight
    if event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
        return build_cors_response(200, {})

    # Extract fileId from path parameters
    path_parameters = event.get("pathParameters", {})
    file_id = path_parameters.get("file_id")

    if not file_id:
        return build_cors_response(400, {"error": "Missing file_id path parameter"})

    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        
        # 1. Fetch data from Supabase ai_analysis table
        response = supabase.table("ai_analysis").select(
            "patients, critical_flags, abnormal_findings, groups, body_map_regions"
        ).eq("file_id", file_id).execute()

        if not response.data or len(response.data) == 0:
            return build_cors_response(404, {"error": "Analysis not found for file_id"})

        cached = response.data[0]

        # 2. Return cached regions if available
        if cached.get("body_map_regions"):
            print("Serving body map from cache.")
            return build_cors_response(200, {"data": cached["body_map_regions"]})

        print("No cached body map regions found, generating with Gemini...")

        patients_output = []
        patient_entries = cached.get("patients")
        
        if patient_entries and len(patient_entries) > 1:
            for pi, p in enumerate(patient_entries):
                p_findings = []
                p_name = p.get("patient_name", f"Patient {pi + 1}")
                p_pages = p.get("pages_referenced") or p.get("pages") or []
                
                # Add overall flags but restrict to patient via page if possible
                if cached.get("critical_flags"):
                    for f in cached["critical_flags"]:
                        f_page = f.get("page")
                        if f_page is not None and p_pages and f_page not in p_pages:
                            continue
                            
                        flag_text = f.get("flag", "")
                        p_findings.append({
                            "text": flag_text, 
                            "severity": "critical", 
                            "type": "critical_flag"
                        })
                        
                if cached.get("abnormal_findings"):
                    for f in cached["abnormal_findings"]:
                        f_page = f.get("page")
                        if f_page is not None and p_pages and f_page not in p_pages:
                            continue
                            
                        finding_text = f"{f.get('finding', '')}: {f.get('value', '')}"
                        severity = "critical" if f.get("severity") == "CRITICAL" else "abnormal"
                        p_findings.append({
                            "text": f"{finding_text} (ref: {f.get('reference', '')})",
                            "severity": severity,
                            "type": "abnormal_finding"
                        })
                            
                p_groups = p.get("groups") or cached.get("groups") or []
                for g in p_groups:
                    for item in g.get("items", []):
                        i_page = item.get("page")
                        is_global = p.get("groups") is None
                        if is_global and i_page is not None and p_pages and i_page not in p_pages:
                            continue

                        if item.get("status") == "abnormal":
                            p_findings.append({
                                "text": f"{item.get('label', '')}: {item.get('value', '')}",
                                "severity": "abnormal",
                                "type": "detail"
                            })
                patients_output.append({
                    "name": p_name,
                    "findings": p_findings
                })
        else:
            single_findings = []
            if cached.get("critical_flags"):
                for f in cached["critical_flags"]:
                    single_findings.append({
                        "text": f.get("flag", ""), 
                        "severity": "critical", 
                        "type": "critical_flag"
                    })
            if cached.get("abnormal_findings"):
                for f in cached["abnormal_findings"]:
                    severity = "critical" if f.get("severity") == "CRITICAL" else "abnormal"
                    single_findings.append({
                        "text": f"{f.get('finding', '')}: {f.get('value', '')} (ref: {f.get('reference', '')})",
                        "severity": severity,
                        "type": "abnormal_finding"
                    })
            
            p_groups = cached.get("groups")
            if patient_entries and len(patient_entries) > 0 and patient_entries[0].get("groups"):
                p_groups = patient_entries[0].get("groups")
                
            if p_groups:
                for g in p_groups:
                    for item in g.get("items", []):
                        if item.get("status") == "abnormal":
                            single_findings.append({
                                "text": f"{item.get('label', '')}: {item.get('value', '')}",
                                "severity": "abnormal",
                                "type": "detail"
                            })
            patient_name = patient_entries[0].get("patient_name", "Patient") if patient_entries else "Patient"
            patients_output.append({"name": patient_name, "findings": single_findings})

        # 4. Process each patient's findings individually
        final_patients = []
        for patient in patients_output:
            patient_name = patient["name"]
            patient_findings = patient["findings"]
            
            # Deduplicate findings per patient
            unique_findings = {}
            for f in patient_findings:
                unique_findings[f["text"]] = f
            patient_unique_findings = list(unique_findings.values())
            
            if len(patient_unique_findings) == 0:
                final_patients.append({
                    "name": patient_name,
                    "regions": {}
                })
                continue
                
            findings_text = "\n".join([f"{i + 1}. [{f['severity'].upper()}] {f['text']}" for i, f in enumerate(patient_unique_findings)])

            body_map_prompt = f"""You are a medical information extraction assistant. Your job is to analyze patient medical records, doctor notes, or symptom descriptions and map findings to specific body regions.

Return ONLY a valid JSON object with body part keys and their medical status as values. No extra text, no markdown, no explanation.

## Body Part Keys (use exactly these):
Head/Face: head, face, jaw, left_eye, right_eye, left_ear, right_ear, nose, mouth
Neck/Spine: neck, upper_spine, lower_spine
Torso: chest, left_lung, right_lung, heart, abdomen, left_kidney, right_kidney, liver, stomach
Arms: left_shoulder, right_shoulder, left_upper_arm, right_upper_arm, left_elbow, right_elbow, left_forearm, right_forearm, left_hand, right_hand
Legs: left_hip, right_hip, left_thigh, right_thigh, left_knee, right_knee, left_shin, right_shin, left_foot, right_foot

## Status Values (use exactly these):
- fractured
- sprained
- bruised
- inflamed
- infected
- swollen
- torn (for ligaments/tendons)
- pain
- normal
- unknown

## Rules:
1. Only include body parts that have a finding — omit healthy/unmentioned parts
2. Be specific about left vs right laterality
3. If laterality is unclear, use both left and right
4. Map anatomical terms to the correct key (e.g. "radius" → left_forearm or right_forearm)
5. If multiple conditions exist on one body part, use the most severe

## Example Input:
"Patient fell off bicycle. X-ray confirms fracture of left radius. Road rash on both knees. Complains of chest pain."

## Example Output:
{{
  "left_forearm": "fractured",
  "left_knee": "bruised",
  "right_knee": "bruised",
  "chest": "pain"
}}

Now analyze the following patient information and return the JSON body map:

# Patient Information:
{findings_text}

Return ONLY the JSON object, no markdown formatting."""

            body_result = model.generate_content(body_map_prompt)
            body_text = body_result.text.replace('```json', '').replace('```', '').strip()
            
            try:
                region_mapping = json.loads(body_text)
            except Exception as e:
                print(f"Error parsing Gemini response: {e}")
                region_mapping = {}

            regions = {}
            if isinstance(region_mapping, dict):
                for region, status in region_mapping.items():
                    # Check if it's a string, if not try to cast or skip
                    if not isinstance(status, str):
                        if isinstance(status, list) and len(status) > 0 and isinstance(status[0], str):
                            status = ", ".join(status)
                        else:
                            status = str(status)
                    
                    # Heuristic for severity based on critical keywords
                    critical_keywords = ["fractured", "torn", "severe", "critical", "ruptured"]
                    is_critical = any(kw in status.lower() for kw in critical_keywords)
                    severity = "critical" if is_critical else "abnormal"
                    
                    regions[region] = {
                        "findings": [{
                            "text": status.capitalize(),
                            "severity": severity
                        }],
                        "severity": severity
                    }
            
            final_patients.append({
                "name": patient_name,
                "regions": regions
            })

        result_data = {"patients": final_patients}

        # 6. Save back to DB to cache future requests
        supabase.table("ai_analysis").update({"body_map_regions": result_data}).eq("file_id", file_id).execute()

        return build_cors_response(200, {"data": result_data})

    except Exception as e:
        traceback.print_exc()
        return build_cors_response(500, {"error": str(e)})
