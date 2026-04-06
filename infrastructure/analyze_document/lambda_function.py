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

# ─────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────
PAGES_PER_CHUNK = 10          # pages fed to a single Gemini call in Pass-1
MAX_CHARS_PER_CHUNK = 80_000  # safety cap per chunk (≈ ~20k tokens)
GEMINI_MODEL = "gemini-2.5-flash-lite"

# ─────────────────────────────────────────────────────────────
# Prompts
# ─────────────────────────────────────────────────────────────

# Partial extraction prompt (Pass-1 / map)
PARTIAL_SYSTEM_PROMPT = """\
You are a medical AI analyzer. Extract ALL clinically relevant information from
the provided pages and return it in the JSON schema below.

Use <page_X>…</page_X> tags to determine and reference accurate page numbers.

CRITICAL ACCURACY RULES:
- DATES: Normalize ALL dates to YYYY-MM-DD format (e.g., "1/15/26" → "2026-01-15", "January 15, 2026" → "2026-01-15"). For 2-digit years, assume 2000s unless context indicates otherwise. If a date cannot be determined, use "unknown".
- TIMELINE: Each timeline event MUST have a specific date. Do NOT create timeline events without dates — if there is no date for an event, omit it from the timeline.
- TIMELINE EVENTS: Be SPECIFIC. Bad: "Patient seen". Good: "Office visit with Dr. Smith for follow-up of lumbar radiculopathy". Include the clinical purpose and relevant details.
- TIMELINE: Use the "event" field for a concise but specific description. Include: what happened, who was involved (provider name if available), and the clinical context.
- PAGE NUMBERS: Every item MUST have an accurate page number from the <page_X> tags. Never guess page numbers.
- DUPLICATE EVENTS: If the same clinical event appears multiple times in these pages (e.g., referenced in a note and then again in a summary), extract it ONCE with the page where the primary documentation exists.
- PATIENT NAMES: Extract patient_name for every timeline event. If only one patient is discussed, still include their name on each event.

Response Schema (strict JSON, no markdown fences):
{
  "document_type": "string",
  "clinical_summary": "narrative summary of THESE pages only",
  "patients": [
    {
      "patient_name": "string",
      "date_of_birth": "YYYY-MM-DD or unknown",
      "facility": "string",
      "provider": "string",
      "summary": "string",
      "chief_complaint": "string",
      "follow_up": "string",
      "pages": [1]
    }
  ],
  "critical_flags": [
    {"flag": "string", "page": 1, "severity": "CRITICAL|HIGH|MEDIUM"}
  ],
  "abnormal_findings": [
    {"finding": "string", "value": "string with units", "reference": "reference range", "page": 1, "severity": "HIGH|MEDIUM|LOW"}
  ],
  "timeline": [
    {"date": "YYYY-MM-DD", "event": "specific clinical event description", "page": 1, "category": "visit|test|procedure|other", "patient_name": "string|null"}
  ],
  "groups": [
    {"title": "string", "items": [{"label": "string", "value": "string", "page": 1, "status": "normal|abnormal|unknown", "reference": "string"}]}
  ]
}"""

# Merge / reduce prompt (Pass-2+ / reduce)
MERGE_SYSTEM_PROMPT = """\
You are a medical AI synthesizer. You receive multiple PARTIAL clinical analysis
JSON objects extracted from different page ranges of the same document.
Merge them into a single, deduplicated, coherent final report using the same
JSON schema.

DEDUPLICATION RULES (follow exactly):
- TIMELINE: Two timeline events are duplicates if they have the SAME date AND describe the SAME clinical event (even if worded differently). Keep the MORE DETAILED version and use the EARLIEST page reference.
- TIMELINE: Sort the final timeline by date (YYYY-MM-DD ascending). Remove any events with no date.
- TIMELINE: If the same visit appears as both "Office visit" and a more detailed description, keep ONLY the detailed version.
- PATIENTS: Match by name similarity (ignore case, handle "John Smith" = "SMITH, JOHN" = "J. Smith"). Merge their data, keeping the most complete version of each field.
- CRITICAL_FLAGS: Two flags are duplicates if they describe the same clinical concern on the same page. Keep the higher severity version.
- ABNORMAL_FINDINGS: Two findings are duplicates if they describe the same test/measurement with the same value. Keep the one with the reference range.
- GROUPS: Merge groups with the same title. Within a group, deduplicate items by label+value.
- CLINICAL_SUMMARY: Combine into one cohesive paragraph. Do not repeat the same information.
- PAGE REFERENCES: Never change page numbers. They must remain accurate to the original source.
- PRESERVE all unique information. When in doubt, keep both items rather than losing data.

Output strict JSON with NO markdown fences.

JSON Schema (same as input partials):
{
  "document_type": "string",
  "clinical_summary": "string",
  "patients": [...],
  "critical_flags": [...],
  "abnormal_findings": [...],
  "timeline": [{"date": "YYYY-MM-DD", "event": "string", "page": 1, "category": "string", "patient_name": "string|null"}],
  "groups": [...]
}"""


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def call_gemini(model: genai.GenerativeModel, system: str, user_content: str) -> dict:
    """Call Gemini and return a parsed JSON dict. Raises on parse failure."""
    prompt = f"{system}\n\n---\n\n{user_content}"
    response = with_retry(lambda: model.generate_content(prompt))
    raw = response.text.replace("```json", "").replace("```", "").strip()
    return json.loads(raw)


def build_page_text(pages: list[dict]) -> str:
    """Wrap page records in <page_N>…</page_N> XML tags."""
    parts = []
    for r in pages:
        p_num = r["page"]
        parts.append(f"<page_{p_num}>\n{r['text']}\n</page_{p_num}>")
    return "\n".join(parts)


def chunk_pages(pages: list[dict], pages_per_chunk: int, max_chars: int) -> list[list[dict]]:
    """
    Split pages into chunks, respecting both a page-count limit and a
    character-count safety cap so we never blow the context window.
    """
    chunks: list[list[dict]] = []
    current_chunk: list[dict] = []
    current_chars = 0

    for page in pages:
        page_chars = len(page.get("text", ""))
        # Start a new chunk if either limit would be exceeded
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


def reduce_partials(
    model: genai.GenerativeModel,
    partials: list[dict],
    max_partials_per_call: int = 10,
) -> dict:
    """
    Recursively merge a list of partial reports until a single report remains.
    Each recursive call merges up to `max_partials_per_call` partials at once.
    """
    print(f"  reduce_partials: merging {len(partials)} partial(s)…")

    if len(partials) == 1:
        return partials[0]

    merged_layer: list[dict] = []
    for i in range(0, len(partials), max_partials_per_call):
        batch = partials[i : i + max_partials_per_call]
        batch_text = json.dumps(batch, ensure_ascii=False)
        merged = call_gemini(
            model,
            MERGE_SYSTEM_PROMPT,
            f"Partial reports to merge:\n{batch_text}",
        )
        merged_layer.append(merged)
        print(f"    merged batch [{i}:{i + len(batch)}] → 1 report")

    # Recurse until we have a single report
    return reduce_partials(model, merged_layer, max_partials_per_call)


# ─────────────────────────────────────────────────────────────
# Lambda entry-point
# ─────────────────────────────────────────────────────────────

def lambda_handler(event, context):
    print("🚀 Starting AI Analysis Lambda (recursive summarization)…")
    print(f"Event received: {json.dumps(event)}")

    # Unwrap Map-state list output
    if isinstance(event, list):
        event = event[0] if event else {}

    file_id = event.get("file_id")
    user_id = event.get("user_id")

    # Fallback: nested Sfn results path
    if not file_id:
        file_id = event.get("pageSplitResult", {}).get("file_id")
    if not user_id:
        user_id = event.get("pageSplitResult", {}).get("user_id")

    if not file_id:
        print(f"CRITICAL: Could not find file_id in keys: {list(event.keys())}")
        raise ValueError("Missing file_id in event payload")

    # Sanitize user_id
    if user_id == 'anonymous':
        user_id = None

    # ── Environment ──────────────────────────────────────────
    SUPABASE_URL = os.environ["SUPABASE_URL"]
    SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]

    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel(GEMINI_MODEL)

    # ── 1. Fetch all OCR pages ───────────────────────────────
    print(f"Fetching OCR text for file_id: {file_id}")
    db_resp = (
        supabase.table("ocr_results")
        .select("page, text")
        .eq("file_id", file_id)
        .order("page")
        .execute()
    )

    if not db_resp.data:
        print("No OCR text found. Skipping analysis.")
        return {"status": "error", "message": "No OCR text found"}

    pages = db_resp.data
    total_pages = len(pages)
    total_chars = sum(len(p.get("text", "")) for p in pages)
    print(f"Total pages: {total_pages} | Total chars: {total_chars:,}")

    # ── 2. Chunk pages ───────────────────────────────────────
    chunks = chunk_pages(pages, PAGES_PER_CHUNK, MAX_CHARS_PER_CHUNK)
    print(f"Split into {len(chunks)} chunk(s) of ≤{PAGES_PER_CHUNK} pages each")

    # ── 3. Pass-1 (Map): extract partials per chunk ──────────
    partials: list[dict] = []
    for idx, chunk in enumerate(chunks):
        page_nums = [p["page"] for p in chunk]
        print(f"  Chunk {idx + 1}/{len(chunks)}: pages {page_nums}")
        page_text = build_page_text(chunk)
        partial = call_gemini(
            model,
            PARTIAL_SYSTEM_PROMPT,
            f"Clinical Text (pages {page_nums[0]}–{page_nums[-1]}):\n{page_text}",
        )
        partials.append(partial)

    # ── 4. Pass-2+ (Reduce): recursively merge partials ──────
    if len(partials) == 1:
        print("Single chunk — no merge needed.")
        final_report = partials[0]
    else:
        print(f"Merging {len(partials)} partials recursively…")
        final_report = reduce_partials(model, partials)

    # ── 5. Persist to Supabase ───────────────────────────────
    print(f"Saving final analysis to DB for file_id: {file_id}")
    supabase.table("ai_analysis").upsert(
        {
            "file_id": file_id,
            "user_id": user_id,
            "document_type": final_report.get("document_type"),
            "clinical_summary": final_report.get("clinical_summary"),
            "patients": final_report.get("patients"),
            "critical_flags": final_report.get("critical_flags"),
            "abnormal_findings": final_report.get("abnormal_findings"),
            "timeline": final_report.get("timeline"),
            "groups": final_report.get("groups"),
            "is_complete": True,
        }
    ).execute()

    print("✅ Analysis complete.")
    return {"status": "success", "file_id": file_id, "user_id": user_id}
