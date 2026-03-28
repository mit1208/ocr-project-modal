import os
import json
import google.generativeai as genai
from supabase import create_client, Client

PAGES_PER_CHUNK = 10
MAX_CHARS_PER_CHUNK = 80_000
GEMINI_MODEL = "gemini-2.5-flash-lite"

PASS1_SYSTEM_PROMPT = """\
You are a medical AI extractor specializing in clinical document analysis. Extract ONLY structured entities from the provided pages. Do NOT summarize or interpret — extract exactly what is written.

CRITICAL RULES:
- Use <page_X> tags to determine the EXACT page number for each entity.
- "source_text" MUST be a direct verbatim quote from the document (copy-paste, do not paraphrase).
- Normalize diagnosis text to standard medical terminology (e.g., "DM2" → "Type 2 diabetes mellitus", "HTN" → "Hypertension").
- For status: use "active" if currently being treated/monitored, "resolved" if explicitly noted as resolved/past, "unknown" if unclear.
- For medications: extract ALL fields. If dose or frequency is missing from the text, set to "not specified" (do not guess).
- For dates: normalize to YYYY-MM-DD format when possible (e.g., "1/15/26" → "2026-01-15", "January 15, 2026" → "2026-01-15"). If year is 2-digit, assume 2000s.
- Extract EVERY diagnosis, medication, procedure, lab, vital, and allergy mentioned — do not skip items even if they seem minor.
- If the same entity appears multiple times on the same page, extract it once.

Return strict JSON (no markdown fences):
{
  "entities": {
    "diagnoses": [
      {"text": "standardized diagnosis name", "status": "active|resolved|unknown", "page": 1, "source_text": "verbatim quote from document"}
    ],
    "medications": [
      {"name": "generic drug name", "dose": "string or not specified", "frequency": "string or not specified", "prescriber": "string or unknown", "page": 1, "source_text": "verbatim quote"}
    ],
    "procedures": [
      {"description": "standard procedure name", "date": "YYYY-MM-DD or unknown", "findings": "key findings or none documented", "page": 1, "source_text": "verbatim quote"}
    ],
    "lab_results": [
      {"test": "standard test name", "value": "numeric value with units", "reference_range": "range or not provided", "date": "YYYY-MM-DD or unknown", "page": 1, "source_text": "verbatim quote"}
    ],
    "vitals": [
      {"name": "vital sign name", "value": "numeric value", "units": "units", "date": "YYYY-MM-DD or unknown", "page": 1, "source_text": "verbatim quote"}
    ],
    "allergies": [
      {"substance": "allergen name", "reaction": "reaction type or not specified", "severity": "severity or not specified", "page": 1, "source_text": "verbatim quote"}
    ]
  }
}"""

PASS2_SYSTEM_PROMPT = """\
You are a certified medical coder (CPC). Map each diagnosis to the MOST SPECIFIC ICD-10-CM code and each procedure to the correct CPT code.

CODING RULES:
- Always code to the highest level of specificity supported by the documentation.
- If laterality is documented (left, right, bilateral), include it in the code.
- If acuity is documented (acute, chronic), include it in the code.
- If a condition has complications documented, code the complication-specific code (e.g., E11.65 not E11.9 for DM with hyperglycemia).
- "confidence" should be "high" only when the documentation clearly supports the code with no ambiguity.
- Use "medium" when the code is reasonable but documentation could support alternatives.
- Use "low" when you are inferring the code from indirect evidence.
- "specificity_note" should explain when a MORE specific code might apply if the provider documents additional detail (e.g., "Specify laterality for more specific code").
- Provide 1-2 alternative codes that a coder might reasonably choose, with the reason each is less preferred.

Return strict JSON (no markdown fences):
{
  "diagnoses": [
    {
      "id": "entity id from input",
      "description": "diagnosis text from input",
      "icd10_code": "X00.00",
      "icd10_description": "official ICD-10-CM description",
      "confidence": "high|medium|low",
      "specificity_note": "string or null",
      "alternatives": [{"code": "X00.0", "description": "official description", "reason": "why less preferred"}]
    }
  ],
  "procedures": [
    {
      "id": "entity id from input",
      "description": "procedure text from input",
      "cpt_code": "00000",
      "cpt_description": "CPT description",
      "modifier_suggestions": ["26 - Professional component"],
      "confidence": "high|medium|low"
    }
  ]
}"""

PASS2_REPROMPT_TEMPLATE = """\
The following ICD-10 codes were NOT found in the official CMS database. For each, I'm providing the closest matches from the database. Please select the best matching code or suggest a corrected code.

Failed codes and their closest alternatives:
{failed_codes}

Return strict JSON (no markdown fences):
{
  "corrections": [
    {
      "id": "entity id",
      "original_code": "the code that failed",
      "corrected_code": "best matching code from alternatives or a corrected code",
      "corrected_description": "description of corrected code",
      "confidence": "high|medium|low",
      "reason": "why this correction was chosen"
    }
  ]
}"""

PASS3_SYSTEM_PROMPT = """\
You are a medical QA auditor reviewing a patient's clinical records for a provider. Your job is to find contradictions, care gaps, and missing data that the provider needs to know about BEFORE seeing the patient.

You will receive TWO inputs:
1. STRUCTURED ENTITIES (extracted from the document) — diagnoses, medications, procedures, labs, vitals, allergies with their IDs and page references.
2. RAW OCR TEXT — the original document text, so you can find phantom references and context that the entity extraction may have missed.

CONTRADICTION DETECTION RULES:
- "diagnosis_conflict": Two entities that contradict each other (e.g., "no history of diabetes" on one page but "Metformin" in the medication list). This is CRITICAL severity.
- "medication_mismatch": Same drug with different doses/frequencies across pages, OR a drug prescribed that contradicts a documented allergy. CRITICAL if allergy-related, WARNING otherwise.
- "lab_trend_alert": Same lab test with clinically significant change between results (e.g., HbA1c 6.1 → 9.4). WARNING severity.
- "temporal_impossibility": Events that can't logically coexist in the timeline (e.g., appendectomy in 2020 but appendicitis in 2024). CRITICAL severity.
- "missing_support": A diagnosis in the problem list with NO supporting evidence (no labs, no imaging, no exam findings). WARNING severity.
- "phantom_reference": The RAW TEXT mentions a test, report, or result (e.g., "see MRI report", "EMG pending", "per cardiology consult") but NO corresponding entity exists in the procedures or lab_results. WARNING severity.

CARE GAP DETECTION RULES (apply standard-of-care guidelines):
- Diabetic patient (any diabetes diagnosis) → check for: HbA1c, eye exam referral, foot exam, renal function (BMP/CMP), lipid panel
- Hypertension → check for: renal function, lipid panel, ECG
- Any medication without a supporting diagnosis → flag as "med_without_dx"
- Any active diagnosis without appropriate medication when standard-of-care expects one → flag as "dx_without_med"
- Medication with missing dose or frequency (listed as "not specified") → flag as "incomplete_med_info"
- Referral mentioned but no follow-up documentation → flag as "missing_followup"

SEVERITY GUIDE:
- "critical": Could cause patient harm if missed (drug-allergy conflict, contradictory diagnoses affecting treatment)
- "warning": Clinically important gap or inconsistency the provider should review
- "info": Minor documentation issue, nice-to-know

IMPORTANT: Only flag REAL issues. Do not flag normal clinical progression (e.g., dose changes over time are expected, not contradictions). Do not flag items where the records simply cover different time periods.

Return strict JSON (no markdown fences):
{
  "contradictions": [
    {
      "id": "contra_001",
      "type": "diagnosis_conflict|medication_mismatch|lab_trend_alert|temporal_impossibility|missing_support|phantom_reference",
      "severity": "critical|warning|info",
      "description": "brief description of the issue",
      "item_a": {"entity_id": "dx_001 or null if from raw text", "text": "what item A says", "page": 1},
      "item_b": {"entity_id": "med_003 or null if from raw text", "text": "what item B says", "page": 5},
      "explanation": "clinical explanation of WHY this is a contradiction",
      "suggested_action": "specific action for the provider to take"
    }
  ],
  "care_gaps": [
    {
      "id": "gap_001",
      "type": "missing_test|missing_followup|med_without_dx|dx_without_med|incomplete_med_info",
      "related_entity_id": "dx_001 or med_001",
      "severity": "warning|info",
      "description": "what is missing",
      "guideline": "which clinical guideline recommends this (e.g., ADA Standards of Care 2025)",
      "suggested_action": "specific action"
    }
  ],
  "missing_data": [
    {
      "id": "missing_001",
      "type": "phantom_reference|missing_results",
      "description": "what is referenced but not found",
      "page": 7,
      "suggested_action": "specific action"
    }
  ]
}"""


def call_gemini_json(model: genai.GenerativeModel, system: str, user_content: str) -> dict:
    prompt = f"{system}\n\n---\n\n{user_content}"
    response = model.generate_content(prompt)
    raw = response.text.replace("```json", "").replace("```", "").strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(raw[start : end + 1])
        raise


def build_page_text(pages: list[dict]) -> str:
    parts = []
    for r in pages:
        p_num = r["page"]
        parts.append(f"<page_{p_num}>\n{r['text']}\n</page_{p_num}>")
    return "\n".join(parts)


def chunk_pages(pages: list[dict], pages_per_chunk: int, max_chars: int) -> list[list[dict]]:
    chunks: list[list[dict]] = []
    current_chunk: list[dict] = []
    current_chars = 0

    for page in pages:
        page_chars = len(page.get("text", ""))
        if current_chunk and (
            len(current_chunk) >= pages_per_chunk
            or current_chars + page_chars > max_chars
        ):
            chunks.append(current_chunk)
            current_chunk = []
            current_chars = 0
        current_chunk.append(page)
        current_chars += page_chars

    if current_chunk:
        chunks.append(current_chunk)

    return chunks


def dedup_entities(items: list[dict], key_fields: list[str]) -> list[dict]:
    seen = {}
    for item in items:
        key = tuple((str(item.get(f) or "")).strip().lower() for f in key_fields)
        if key not in seen:
            seen[key] = item
            if "page" in item:
                seen[key]["source_pages"] = [item["page"]]
        else:
            # Aggregate pages
            if "page" in item and item["page"] not in seen[key].get("source_pages", []):
                seen[key].setdefault("source_pages", []).append(item["page"])
    
    return list(seen.values())


def assign_ids(items: list[dict], prefix: str) -> list[dict]:
    result = []
    for idx, item in enumerate(items, start=1):
        item["id"] = f"{prefix}_{idx:03d}"
        result.append(item)
    return result


def batch_validate_icd10(supabase: Client, diagnoses: list[dict]) -> dict:
    """Validate all ICD-10 codes in a single batch query. Returns {code: validation_result}."""
    codes = [dx.get("icd10_code") for dx in diagnoses if dx.get("icd10_code")]
    if not codes:
        return {}

    # Single batch lookup
    resp = (
        supabase.table("icd10_codes")
        .select("code, description, is_hcc, hcc_category")
        .in_("code", codes)
        .execute()
    )
    found = {r["code"]: r for r in (resp.data or [])}

    results = {}
    failed = []  # Track codes that need alternatives

    for dx in diagnoses:
        code = dx.get("icd10_code")
        if not code:
            results[dx["id"]] = {"validated": False, "icd10_description": None, "hcc_relevant": False, "hcc_category": None, "alternatives": []}
            continue

        if code in found:
            r = found[code]
            results[dx["id"]] = {
                "validated": True,
                "icd10_description": r.get("description"),
                "hcc_relevant": bool(r.get("is_hcc")),
                "hcc_category": r.get("hcc_category"),
                "alternatives": [],
            }
        else:
            failed.append(dx)
            results[dx["id"]] = {"validated": False, "icd10_description": None, "hcc_relevant": False, "hcc_category": None, "alternatives": []}

    # Batch search alternatives for all failed codes
    for dx in failed:
        description = dx.get("text", "")
        # Use ilike for reliable cross-version Supabase client compatibility
        search_term = description[:40] if description else ""
        alt_resp = (
            supabase.table("icd10_codes")
            .select("code, description")
            .ilike("description", f"%{search_term}%")
            .limit(5)
            .execute()
        )
        alternatives = [
            {"code": a.get("code"), "description": a.get("description"), "reason": "Closest match from CMS database"}
            for a in (alt_resp.data or [])
            if a.get("code")
        ]
        results[dx["id"]] = {"validated": False, "icd10_description": None, "hcc_relevant": False, "hcc_category": None, "alternatives": alternatives}

    return results


def reprompt_failed_codes(model, diagnoses: list[dict], validation_results: dict) -> dict:
    """Re-prompt Gemini with alternatives for codes that failed validation. Returns {id: corrected_data}."""
    failed_items = []
    for dx in diagnoses:
        v = validation_results.get(dx["id"])
        if v and not v["validated"] and v["alternatives"]:
            alts_text = ", ".join(f'{a["code"]} ({a["description"]})' for a in v["alternatives"])
            failed_items.append({
                "id": dx["id"],
                "original_code": dx.get("icd10_code"),
                "description": dx.get("text", ""),
                "alternatives": alts_text,
            })

    if not failed_items:
        return {}

    failed_text = json.dumps(failed_items, ensure_ascii=False)
    prompt = PASS2_REPROMPT_TEMPLATE.replace("{failed_codes}", failed_text)
    result = call_gemini_json(model, prompt, "Please correct the codes above.")
    corrections = {c["id"]: c for c in (result.get("corrections") or [])}
    return corrections


def update_intake_status(supabase, file_id, user_id, status, passes_data=None, clinical_intake=None):
    update_data = {
        "file_id": file_id,
        "user_id": user_id,
        "intake_status": status,
    }
    if passes_data is not None:
        update_data["intake_passes"] = passes_data
    if clinical_intake is not None:
        update_data["clinical_intake"] = clinical_intake
    
    supabase.table("ai_analysis").upsert(update_data).execute()


def lambda_handler(event, context):
    print("Starting clinical intake lambda")
    
    if isinstance(event, list):
        event = event[0] if event else {}

    file_id = event.get("file_id") or event.get("pageSplitResult", {}).get("file_id")
    user_id = event.get("user_id") or event.get("pageSplitResult", {}).get("user_id")

    if not file_id:
        raise ValueError("Missing file_id in event payload")

    if user_id == "anonymous":
        user_id = None

    SUPABASE_URL = os.environ["SUPABASE_URL"]
    SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]

    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)

    # Initialize status
    intake_passes = {}
    update_intake_status(supabase, file_id, user_id, "pending", intake_passes)

    try:
        # Fetch OCR Text
        db_resp = (
            supabase.table("ocr_results")
            .select("page, text")
            .eq("file_id", file_id)
            .order("page")
            .execute()
        )

        if not db_resp.data:
            update_intake_status(supabase, file_id, user_id, "failed", {"error": "No OCR text found"})
            return {"status": "error", "message": "No OCR text found"}

        pages = db_resp.data
        chunks = chunk_pages(pages, PAGES_PER_CHUNK, MAX_CHARS_PER_CHUNK)

        # PASS 1: Entity Extraction
        print("Starting Pass 1: Entity Extraction")
        all_entities = {
            "diagnoses": [], "medications": [], "procedures": [],
            "lab_results": [], "vitals": [], "allergies": [],
        }

        for idx, chunk in enumerate(chunks):
            page_nums = [p["page"] for p in chunk]
            page_text = build_page_text(chunk)
            partial = call_gemini_json(
                model,
                PASS1_SYSTEM_PROMPT,
                f"Clinical Text (pages {page_nums[0]}–{page_nums[-1]}):\n{page_text}",
            )
            entities = (partial or {}).get("entities", {})
            for key in all_entities:
                all_entities[key].extend(entities.get(key, []) or [])

        # Dedup and assign IDs
        diagnoses = assign_ids(dedup_entities(all_entities["diagnoses"], ["text", "status"]), "dx")
        medications = assign_ids(dedup_entities(all_entities["medications"], ["name", "dose", "frequency"]), "med")
        procedures = assign_ids(dedup_entities(all_entities["procedures"], ["description", "date"]), "proc")
        lab_results = assign_ids(dedup_entities(all_entities["lab_results"], ["test", "value", "date"]), "lab")
        vitals = assign_ids(dedup_entities(all_entities["vitals"], ["name", "value", "date"]), "vital")
        allergies = assign_ids(dedup_entities(all_entities["allergies"], ["substance", "reaction"]), "allergy")

        pass1_data = {
            "diagnoses": diagnoses,
            "medications": medications,
            "procedures": procedures,
            "lab_results": lab_results,
            "vitals": vitals,
            "allergies": allergies,
        }
        intake_passes["pass_1"] = pass1_data
        update_intake_status(supabase, file_id, user_id, "pass_1_complete", intake_passes)

        # PASS 2: ICD-10/CPT Code Mapping
        print("Starting Pass 2: Coding")
        coding_payload = {
            "diagnoses": [{"id": d["id"], "description": d.get("text", ""), "source_text": d.get("source_text", "")} for d in diagnoses],
            "procedures": [{"id": p["id"], "description": p.get("description", ""), "source_text": p.get("source_text", "")} for p in procedures],
        }
        coding = call_gemini_json(
            model,
            PASS2_SYSTEM_PROMPT,
            f"Entities to code:\n{json.dumps(coding_payload, ensure_ascii=False)}",
        )

        coded_dx = {d.get("id"): d for d in coding.get("diagnoses", [])}
        coded_proc = {p.get("id"): p for p in coding.get("procedures", [])}

        # Apply initial Gemini coding
        for dx in diagnoses:
            mapped = coded_dx.get(dx["id"], {})
            dx.update({
                "icd10_code": mapped.get("icd10_code"),
                "icd10_description": mapped.get("icd10_description"),
                "confidence": mapped.get("confidence"),
                "specificity_note": mapped.get("specificity_note"),
                "alternatives": mapped.get("alternatives") or []
            })

        # Batch validate ALL codes in a single query
        validation_results = batch_validate_icd10(supabase, diagnoses)

        # Apply validation results
        for dx in diagnoses:
            v = validation_results.get(dx["id"], {})
            if not v:
                continue
            dx.update({
                "validated": v["validated"],
                "icd10_description": v.get("icd10_description") or dx.get("icd10_description"),
                "hcc_relevant": v.get("hcc_relevant", False),
                "hcc_category": v.get("hcc_category"),
            })
            if v.get("alternatives"):
                dx["alternatives"] = v["alternatives"]

        # Re-prompt Gemini for codes that failed validation (single batched call)
        corrections = reprompt_failed_codes(model, diagnoses, validation_results)
        if corrections:
            print(f"  Re-prompting corrected {len(corrections)} codes")
            for dx in diagnoses:
                correction = corrections.get(dx["id"])
                if correction:
                    dx["icd10_code"] = correction.get("corrected_code", dx.get("icd10_code"))
                    dx["icd10_description"] = correction.get("corrected_description", dx.get("icd10_description"))
                    dx["confidence"] = correction.get("confidence", dx.get("confidence"))
            # Re-validate corrected codes
            re_validation = batch_validate_icd10(supabase, [dx for dx in diagnoses if dx["id"] in corrections])
            for dx in diagnoses:
                rv = re_validation.get(dx["id"])
                if rv:
                    dx["validated"] = rv["validated"]
                    dx["icd10_description"] = rv.get("icd10_description") or dx.get("icd10_description")
                    dx["hcc_relevant"] = rv.get("hcc_relevant", False)
                    dx["hcc_category"] = rv.get("hcc_category")

        for proc in procedures:
            mapped = coded_proc.get(proc["id"], {})
            proc.update({
                "cpt_code": mapped.get("cpt_code"),
                "cpt_description": mapped.get("cpt_description"),
                "modifier_suggestions": mapped.get("modifier_suggestions") or [],
                "confidence": mapped.get("confidence"),
                "validated": False  # CPT validation requires licensed data
            })

        intake_passes["pass_2"] = {"diagnoses": diagnoses, "procedures": procedures}
        update_intake_status(supabase, file_id, user_id, "pass_2_complete", intake_passes)

        # PASS 3: Contradiction Detection + Care Gaps
        print("Starting Pass 3: QA Audit")
        pass3_payload = {
            "diagnoses": diagnoses,
            "medications": medications,
            "procedures": procedures,
            "lab_results": lab_results,
            "vitals": vitals,
            "allergies": allergies,
        }
        # Build a condensed version of raw OCR for phantom reference detection
        # (full text may exceed context — use first 100k chars which covers ~25 pages)
        raw_ocr_condensed = build_page_text(pages)
        if len(raw_ocr_condensed) > 100_000:
            raw_ocr_condensed = raw_ocr_condensed[:100_000] + "\n\n[... remaining pages truncated ...]"

        pass3_input = (
            f"STRUCTURED ENTITIES:\n{json.dumps(pass3_payload, ensure_ascii=False)}"
            f"\n\n---\n\nRAW OCR TEXT (for phantom reference detection):\n{raw_ocr_condensed}"
        )
        contradictions = call_gemini_json(
            model,
            PASS3_SYSTEM_PROMPT,
            pass3_input,
        )

        contradictions_list = contradictions.get("contradictions", []) or []
        care_gaps = contradictions.get("care_gaps", []) or []
        missing_data = contradictions.get("missing_data", []) or []

        # Build entity lookup for resolving IDs to page numbers
        entity_pages = {}
        for entity_list in [diagnoses, medications, procedures, lab_results, vitals, allergies]:
            for e in entity_list:
                if not isinstance(e, dict):
                    continue
                eid = e.get("id")
                if eid:
                    entity_pages[eid] = e.get("source_pages") or ([e["page"]] if e.get("page") is not None else [])

        def resolve_pages_for_flag(item: dict) -> list:
            """Extract all page references from a flag, resolving entity IDs to pages."""
            pages = []
            # From item_a / item_b
            for key in ("item_a", "item_b"):
                ref = item.get(key)
                if isinstance(ref, dict):
                    if isinstance(ref.get("page"), int):
                        pages.append(ref["page"])
                    eid = ref.get("entity_id")
                    if eid and eid in entity_pages:
                        pages.extend(entity_pages[eid])
            # From related_entity_id
            rel_id = item.get("related_entity_id")
            if rel_id and rel_id in entity_pages:
                pages.extend(entity_pages[rel_id])
            # From direct page field
            if isinstance(item.get("page"), int):
                pages.append(item["page"])
            # Deduplicate and sort
            return sorted(set(pages))

        flags = []
        for item in contradictions_list:
            flags.append({
                "id": item.get("id"), "type": "contradiction", "severity": item.get("severity", "warning"),
                "description": item.get("description"), "explanation": item.get("explanation"),
                "suggested_action": item.get("suggested_action"),
                "item_a": item.get("item_a"), "item_b": item.get("item_b"),
                "pages": resolve_pages_for_flag(item),
            })
        for item in care_gaps:
            flags.append({
                "id": item.get("id"), "type": "care_gap", "severity": item.get("severity", "warning"),
                "description": item.get("description"), "explanation": item.get("guideline"),
                "suggested_action": item.get("suggested_action"),
                "related_entity_id": item.get("related_entity_id"),
                "pages": resolve_pages_for_flag(item),
            })
        for item in missing_data:
            if not isinstance(item, dict): continue
            flags.append({
                "id": item.get("id"), "type": "missing_data", "severity": "warning",
                "description": item.get("description"), "explanation": None,
                "suggested_action": item.get("suggested_action"),
                "pages": resolve_pages_for_flag(item),
            })

        intake_passes["pass_3"] = {"flags": flags}
        update_intake_status(supabase, file_id, user_id, "pass_3_complete", intake_passes)

        # PASS 4: Compose Intake Sheet
        print("Starting Pass 4: Composition")
        
        problem_list = []
        for dx in diagnoses:
            if not isinstance(dx, dict): continue
            dx_id = dx.get("id")
            dx_flags = []
            for f in flags:
                if not isinstance(f, dict): continue
                if f.get("related_entity_id") == dx_id:
                    dx_flags.append(f.get("id"))
                    continue
                
                item_a = f.get("item_a")
                if isinstance(item_a, dict) and item_a.get("entity_id") == dx_id:
                    dx_flags.append(f.get("id"))
                    continue
                    
                item_b = f.get("item_b")
                if isinstance(item_b, dict) and item_b.get("entity_id") == dx_id:
                    dx_flags.append(f.get("id"))
                    continue

            problem_list.append({
                "id": dx_id, "description": dx.get("text"), "icd10_code": dx.get("icd10_code"),
                "icd10_description": dx.get("icd10_description"), "status": dx.get("status"),
                "source_pages": dx.get("source_pages", []), "source_text": dx.get("source_text"),
                "flags": dx_flags, "hcc_relevant": dx.get("hcc_relevant", False),
                "validated": dx.get("validated", False), "confidence": dx.get("confidence"),
            })

        medications_out = []
        for med in medications:
            if not isinstance(med, dict): continue
            med_id = med.get("id")
            med_flags = []
            for f in flags:
                if not isinstance(f, dict): continue
                item_a = f.get("item_a")
                if isinstance(item_a, dict) and item_a.get("entity_id") == med_id:
                    med_flags.append(f.get("id"))
                    continue
                item_b = f.get("item_b")
                if isinstance(item_b, dict) and item_b.get("entity_id") == med_id:
                    med_flags.append(f.get("id"))
                    continue

            medications_out.append({
                "id": med_id, "name": med.get("name"), "dose": med.get("dose"),
                "frequency": med.get("frequency"), "prescriber": med.get("prescriber"),
                "source_pages": med.get("source_pages", []), "source_text": med.get("source_text"),
                "flags": med_flags,
            })
        completed_workup = []
        for proc in procedures:
            completed_workup.append({
                "id": proc["id"], "description": proc.get("description"), "cpt_code": proc.get("cpt_code"),
                "cpt_description": proc.get("cpt_description"), "date": proc.get("date"),
                "key_findings": proc.get("findings"), "status": "completed",
                "validated": proc.get("validated", False), "source_pages": proc.get("source_pages", []),
            })

        for missing in missing_data:
            completed_workup.append({
                "id": missing.get("id"), "description": missing.get("description"),
                "status": "referenced_missing", "referenced_on_page": missing.get("page"),
            })

        suggested_next_steps = []
        for item in flags:
            action = item.get("suggested_action")
            if action and action not in suggested_next_steps:
                suggested_next_steps.append(action)

        clinical_intake = {
            "problem_list": problem_list,
            "medications": medications_out,
            "completed_workup": completed_workup,
            "flags": flags,
            "suggested_next_steps": suggested_next_steps,
        }

        update_intake_status(supabase, file_id, user_id, "complete", intake_passes, clinical_intake)
        print("Clinical Intake complete")
        return {"status": "success", "file_id": file_id}

    except Exception as e:
        print(f"Error in clinical intake: {str(e)}")
        import traceback
        traceback.print_exc()
        if not isinstance(intake_passes, dict):
            intake_passes = {}
        intake_passes["error"] = str(e)
        update_intake_status(supabase, file_id, user_id, "failed", intake_passes)
        return {"status": "error", "message": str(e)}
