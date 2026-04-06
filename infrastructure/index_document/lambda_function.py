import os
import json
import time
import google.generativeai as genai
from supabase import create_client, Client


def with_retry(fn, max_retries=3, base_delay=0.5):
    """Retry a callable with exponential backoff for transient Gemini errors."""
    for attempt in range(1, max_retries + 1):
        try:
            return fn()
        except Exception as e:
            msg = str(e)
            retryable = "429" in msg or "503" in msg or "RESOURCE_EXHAUSTED" in msg or "overloaded" in msg
            if not retryable or attempt == max_retries:
                raise
            delay = base_delay * (2 ** (attempt - 1))
            print(f"  [Gemini] Attempt {attempt} failed ({msg}), retrying in {delay:.1f}s...")
            time.sleep(delay)

GEMINI_MODEL = "gemini-2.5-flash-lite"

SYSTEM_PROMPT = """You are a medical document indexer with memory. You will analyze ONE page at a time,
using the provided context to decide whether a new section starts or the current section continues.
Return strict JSON only (no markdown) with the following schema:
{
  "page_summary": "1-2 short sentences describing this page",
  "section_title": "short label for the section this page belongs to",
  "section_type": "ocf_form|clinic_note|imaging|billing|lab|medication|pt_note|operative|administrative|other",
  "is_section_start": true|false,
  "section_memory": "short persistent summary of the CURRENT section (2-4 bullets or short sentences)",
  "has_clinic_note": true|false,
  "timeline_events": [
    {"date": "string", "event": "string", "page": 1, "category": "visit|test|procedure|other", "patient_name": "string|null"}
  ]
}

Rules:
- Use the provided previous section memory and previous page summary to maintain continuity.
- If this page continues the same section as the previous page, keep section_title/section_type consistent and set is_section_start=false.
- If this page begins a new form/note/report, set is_section_start=true and reset section_memory to the new section.
- Only include timeline_events when has_clinic_note=true.
- Keep page_summary concise and precise.
"""

RECONCILE_PROMPT = """You are reconciling section boundaries for a medical document.
You receive a list of pages with summaries and their CURRENT section assignments.
Correct section boundaries ONLY if you are confident, otherwise keep them unchanged.

Output strict JSON only:
{
  "pages": [
    {"page": 1, "section_title": "string", "section_type": "string", "is_section_start": true|false, "section_memory": "string"}
  ]
}

Rules:
- Ensure sections are contiguous: a section's pages should be consecutive.
- Only the FIRST page of a section should have is_section_start=true.
- If a section continues, keep section_title/type consistent.
- Prefer stability: minimal changes unless a boundary is clearly wrong.
"""


def call_gemini(model: genai.GenerativeModel, payload: str) -> dict:
    response = with_retry(lambda: model.generate_content(payload))
    raw = response.text.replace("```json", "").replace("```", "").strip()
    return json.loads(raw)


def reconcile_sections(model: genai.GenerativeModel, page_rows: list[dict]) -> list[dict]:
    window_size = 20
    overlap = 4
    reconciled = {row["page"]: dict(row) for row in page_rows}

    for start in range(0, len(page_rows), window_size - overlap):
        end = min(start + window_size, len(page_rows))
        window = page_rows[start:end]
        window_payload = json.dumps([
            {
                "page": w["page"],
                "page_summary": w.get("page_summary", ""),
                "section_title": w.get("section_title", ""),
                "section_type": w.get("section_type", ""),
                "is_section_start": w.get("is_section_start", False),
                "section_memory": w.get("section_memory", "")
            }
            for w in window
        ], ensure_ascii=False)

        payload = f"{RECONCILE_PROMPT}\n\nPages:\n{window_payload}"
        try:
            result = call_gemini(model, payload)
        except Exception as e:
            print(f"Reconcile failed for pages {window[0]['page']}–{window[-1]['page']}: {e}")
            continue

        updates = result.get("pages") or []
        update_map = {u.get("page"): u for u in updates if u.get("page")}

        apply_start = start if start == 0 else start + overlap
        for i in range(apply_start, end):
            page_num = page_rows[i]["page"]
            update = update_map.get(page_num)
            if not update:
                continue
            row = reconciled.get(page_num, {})
            row["section_title"] = (update.get("section_title") or row.get("section_title") or "Other").strip()
            row["section_type"] = (update.get("section_type") or row.get("section_type") or "other").strip()
            if "is_section_start" in update:
                row["is_section_start"] = bool(update.get("is_section_start"))
            if update.get("section_memory"):
                row["section_memory"] = update.get("section_memory")
            reconciled[page_num] = row

    # Enforce boundary consistency
    ordered = [reconciled[row["page"]] for row in page_rows]
    for i, row in enumerate(ordered):
        if i == 0:
            row["is_section_start"] = True
        else:
            prev = ordered[i - 1]
            if row.get("section_title") != prev.get("section_title") or row.get("section_type") != prev.get("section_type"):
                row["is_section_start"] = True
            else:
                row["is_section_start"] = False
    return ordered


def lambda_handler(event, context):
    print("Starting document indexing...")
    print(f"Event: {json.dumps(event)}")

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

    db_resp = (
        supabase.table("ocr_results")
        .select("page, text")
        .eq("file_id", file_id)
        .order("page")
        .execute()
    )

    if not db_resp.data:
        print("No OCR text found. Skipping index.")
        return {"status": "error", "message": "No OCR text found"}

    pages = db_resp.data

    page_index_rows = []
    timeline_events = []

    prev_section_title = ""
    prev_section_type = ""
    prev_page_summary = ""
    section_memory = ""
    document_memory = []

    for idx, r in enumerate(pages):
        page_num = r["page"]
        text = r.get("text", "") or ""
        next_text = ""
        if idx + 1 < len(pages):
            next_text = (pages[idx + 1].get("text", "") or "")[:1200]

        doc_memory_text = "\n".join(f"- {m}" for m in document_memory[-6:]) or "NONE"
        payload = (
            f"{SYSTEM_PROMPT}\n\n"
            f"Previous section_title: {prev_section_title or 'NONE'}\n"
            f"Previous section_type: {prev_section_type or 'NONE'}\n"
            f"Previous page_summary: {prev_page_summary or 'NONE'}\n"
            f"Current section_memory: {section_memory or 'NONE'}\n\n"
            f"Document memory (recent sections):\n{doc_memory_text}\n\n"
            f"Next page preview (if any):\n{next_text}\n\n"
            f"<page_{page_num}>\n{text}\n</page_{page_num}>"
        )

        try:
            result = call_gemini(model, payload)
        except Exception as e:
            print(f"Indexing failed for page {page_num}: {e}")
            continue

        section_title = (result.get("section_title") or "Other").strip()
        section_type = (result.get("section_type") or "other").strip()
        is_section_start = bool(result.get("is_section_start"))
        page_summary = result.get("page_summary") or ""
        new_section_memory = result.get("section_memory") or ""
        has_clinic_note = bool(result.get("has_clinic_note"))
        events = result.get("timeline_events") or []

        # Normalize section boundaries to avoid drift
        if section_title and prev_section_title and section_title != prev_section_title and not is_section_start:
            is_section_start = True
        if is_section_start:
            if section_memory:
                document_memory.append(section_memory)
            prev_section_title = section_title
            prev_section_type = section_type
            section_memory = new_section_memory or page_summary
        else:
            section_memory = new_section_memory or section_memory

        page_index_rows.append({
            "page": page_num,
            "page_summary": page_summary,
            "section_title": section_title,
            "section_type": section_type,
            "is_section_start": is_section_start,
            "section_memory": section_memory,
            "has_clinic_note": has_clinic_note,
        })

        prev_page_summary = page_summary

        if has_clinic_note and events:
            for ev in events:
                ev["page"] = page_num
            timeline_events.extend(events)

    # Second pass reconciliation for section boundaries
    page_index_rows = reconcile_sections(model, page_index_rows)

    # Build document-level index by grouping consecutive pages
    document_index = []
    current_section = None

    for item in page_index_rows:
        if item["is_section_start"] or current_section is None:
            if current_section:
                document_index.append(current_section)
            current_section = {
                "title": item["section_title"],
                "type": item["section_type"],
                "start_page": item["page"],
                "end_page": item["page"],
                "summary": item["page_summary"],
            }
        else:
            current_section["end_page"] = item["page"]

    if current_section:
        document_index.append(current_section)

    # Persist page_index, document_index and timeline_index into ai_analysis
    # Do NOT set is_complete here, as analyze_document must still run
    supabase.table("ai_analysis").upsert({
        "file_id": file_id,
        "user_id": user_id,
        "page_index": page_index_rows,
        "document_index": document_index,
        "timeline_index": timeline_events
    }).execute()

    print("Document indexing complete.")
    return {"status": "success", "file_id": file_id, "sections": len(document_index)}
