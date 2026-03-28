# Clinical Intake Sheet & Medical Coding Feature — Design Spec

**Date:** 2026-03-16
**Status:** Draft
**Target Users:** NPs/MDs in clinical practice

---

## Problem Statement

NPs and MDs spend 20-30 minutes manually reviewing incoming patient records from other providers. They need to extract diagnoses, medications, completed workup, and identify gaps — all before they can begin their own clinical work. This platform already OCRs and summarizes medical documents, but the output is narrative and not actionable.

Additionally, the existing chronology and issue detection features suffer from inconsistent accuracy because the current architecture asks Gemini to do everything in a single pass.

## Solution: Clinical Intake Sheet

Transform the platform from a document summarizer into a **clinical decision-support tool**. When a provider uploads incoming records, the system produces a structured, coded, auditable Clinical Intake Sheet with five sections:

1. **Problem List** — active/resolved diagnoses with ICD-10 codes
2. **Medications** — current med list with gap/interaction flags
3. **Completed Workup** — labs, imaging, procedures already done (with CPT codes)
4. **Missing Data Flags** — contradictions, care gaps, phantom references
5. **Suggested Next Steps** — documentation-driven action prompts

Every item is traceable to an exact source page in the original document.

## Architecture

### Pipeline Addition

A new `clinical_intake` Lambda function added to the existing Step Functions pipeline, running after `analyze_document` and `compute_embeddings`:

```
S3 Upload → EventBridge → Step Functions
  ├─ pdf_split (existing, unchanged)
  ├─ invoke_ocr (existing, unchanged)
  ├─ index_document (existing, unchanged)
  ├─ analyze_document (existing, unchanged)
  ├─ compute_embeddings (existing, unchanged)
  └─ clinical_intake (NEW)
       ├─ Pass 1: Entity extraction
       ├─ Pass 2: ICD-10/CPT mapping + validation
       ├─ Pass 3: Contradiction detection + care gaps
       └─ Pass 4: Compose intake sheet
```

### Data Flow

The `clinical_intake` Lambda receives `file_id` and `user_id` from the Step Functions event payload. It then **queries Supabase directly** for all required data:
- Raw OCR text from `ocr_results` table
- `page_index` and `document_index` from `ai_analysis` table

This is consistent with how `analyze_document` and `compute_embeddings` already work. Step Functions payload size limits (256KB) make inline data passing infeasible for large documents.

### Gemini Model

All passes use **`gemini-2.5-flash-lite`**, consistent with the existing `analyze_document` Lambda. This model provides the best cost/accuracy balance. If accuracy gaps are identified in production, individual passes can be upgraded to `gemini-2.5-flash` without architectural changes.

### Gemini Multi-Pass Pipeline (clinical_intake Lambda)

#### Pass 1: Entity Extraction

**Input:** Raw OCR text (queried from ocr_results), page_index and document_index (queried from ai_analysis)

**Prompt strategy:** Focused exclusively on structured extraction. No summarization, no reasoning.

**Output schema:**
```json
{
  "entities": {
    "diagnoses": [
      {
        "id": "dx_001",
        "text": "Type 2 diabetes mellitus with hyperglycemia",
        "status": "active",
        "page": 2,
        "source_text": "Assessment: Type 2 DM with hyperglycemia, poorly controlled"
      }
    ],
    "medications": [
      {
        "id": "med_001",
        "name": "Metformin",
        "dose": "1000mg",
        "frequency": "BID",
        "prescriber": "Dr. Smith",
        "page": 5,
        "source_text": "Metformin 1000mg twice daily"
      }
    ],
    "procedures": [
      {
        "id": "proc_001",
        "description": "MRI lumbar spine without contrast",
        "date": "2026-01-15",
        "findings": "Herniation at L4-L5",
        "page": 8,
        "source_text": "MRI lumbar 1/15/26: L4-5 disc herniation"
      }
    ],
    "lab_results": [
      {
        "id": "lab_001",
        "test": "HbA1c",
        "value": "9.4%",
        "reference_range": "4.0-5.6%",
        "date": "2026-01-10",
        "page": 6,
        "source_text": "HbA1c: 9.4 (ref 4.0-5.6)"
      }
    ],
    "vitals": [...],
    "allergies": [...]
  }
}
```

**Chunked processing for large documents (>300k chars):** Uses existing 10-page chunk pattern. Entity IDs are generated per-chunk with chunk prefix (e.g., `c1_dx_001`, `c2_dx_001`). Merge step deduplicates by matching on: diagnosis text + status (for diagnoses), drug name + dose (for medications), procedure description + date (for procedures), test name + date (for labs). Merged entities get stable final IDs (`dx_001`, `dx_002`, etc.) with all source pages aggregated.

#### Pass 2: ICD-10/CPT Code Mapping

**Input:** Pass 1 entities

**Process:**
1. Gemini maps **all diagnoses and procedures in a single call** to ICD-10/CPT codes (batched, not one-by-one)
2. All suggested codes are validated in a **single batched query** against `icd10_codes`/`cpt_codes` tables: `SELECT code, description FROM icd10_codes WHERE code IN (...)`
3. For codes that fail validation, the Lambda fetches the top-3 closest matches using text search: `SELECT code, description FROM icd10_codes WHERE to_tsvector('english', description) @@ plainto_tsquery('english', $entity_text) LIMIT 3`
4. All failed codes are **re-prompted in a single batched Gemini call** with their closest matches
5. Output includes alternatives and specificity notes

**Output schema (per diagnosis):**
```json
{
  "id": "dx_001",
  "description": "Type 2 diabetes mellitus with hyperglycemia",
  "icd10_code": "E11.65",
  "icd10_description": "Type 2 diabetes mellitus with hyperglycemia",
  "validated": true,
  "confidence": "high",
  "specificity_note": null,
  "alternatives": [
    {"code": "E11.9", "description": "Type 2 DM without complications", "reason": "Less specific"}
  ],
  "hcc_relevant": true,
  "hcc_category": "HCC 18",
  "source_pages": [2]
}
```

**Output schema (per procedure):**
```json
{
  "id": "proc_001",
  "description": "MRI lumbar spine without contrast",
  "cpt_code": "72148",
  "cpt_description": "MRI lumbar spine w/o contrast",
  "validated": true,
  "modifier_suggestions": ["26 - Professional component"],
  "source_pages": [8]
}
```

#### Pass 3: Contradiction Detection + Care Gaps

**Input:** Pass 1 entities + Pass 2 coded entities

**Contradiction types detected:**

| Type | Logic | Example |
|---|---|---|
| Diagnosis conflict | Same condition, contradictory status across pages | "No diabetes" p.2 vs "Metformin" in med list p.5 |
| Medication mismatch | Same drug, different dose/frequency | "Lisinopril 10mg" p.3 vs "Lisinopril 20mg" p.8 |
| Lab trend alert | Same test, clinically significant change | "HbA1c 6.1" p.2 vs "HbA1c 9.4" p.12 |
| Temporal impossibility | Events that can't coexist | "Appendectomy 2020" vs "Appendicitis 2024" |
| Missing support | Diagnosis with no supporting evidence | "COPD" in problem list, no PFTs found |
| Phantom reference | References results not in the record | "See MRI results" — no MRI report present |

**Care gap detection rules:**
- Diabetic patient → check for HbA1c, eye exam, foot exam, renal function
- Hypertension → check for renal function, lipid panel
- Medication listed without diagnosis supporting it
- Diagnosis listed without medication when standard-of-care expects one
- Referral mentioned with no follow-up documentation
- Incomplete medication info (drug without dose/frequency)

**Output schema:**
```json
{
  "contradictions": [
    {
      "id": "contra_001",
      "type": "diagnosis_conflict",
      "severity": "critical",
      "description": "Diabetes status contradicted across records",
      "item_a": {"text": "No history of diabetes", "page": 2, "entity_id": "dx_005"},
      "item_b": {"text": "Metformin 1000mg BID", "page": 5, "entity_id": "med_001"},
      "explanation": "Page 2 denies diabetes but page 5 lists Metformin, a first-line diabetes medication",
      "suggested_action": "Verify current diabetes status with patient"
    }
  ],
  "care_gaps": [
    {
      "id": "gap_001",
      "type": "missing_test",
      "related_diagnosis": "dx_001",
      "description": "No ophthalmology referral found for diabetic patient",
      "guideline": "ADA Standards of Care recommend annual dilated eye exam",
      "suggested_action": "Refer ophthalmology for diabetic screening"
    }
  ],
  "missing_data": [
    {
      "id": "missing_001",
      "type": "phantom_reference",
      "description": "EMG referenced on page 7 but no results found in records",
      "page": 7,
      "suggested_action": "Request EMG results from referring provider"
    }
  ]
}
```

#### Pass 4: Compose Intake Sheet

**Input:** All outputs from Passes 1-3

**Job:** Assemble the final `clinical_intake` JSON, dedup, resolve formatting, and structure for display.

**Output schema:**
```json
{
  "problem_list": [
    {
      "id": "dx_001",
      "description": "Type 2 DM with hyperglycemia",
      "icd10_code": "E11.65",
      "status": "active",
      "source_pages": [2],
      "source_text": "Assessment: Type 2 DM with hyperglycemia, poorly controlled",
      "flags": ["contra_001"],
      "hcc_relevant": true
    }
  ],
  "medications": [
    {
      "id": "med_001",
      "name": "Metformin",
      "dose": "1000mg",
      "frequency": "BID",
      "prescriber": "Dr. Smith",
      "source_pages": [5],
      "flags": []
    }
  ],
  "completed_workup": [
    {
      "id": "proc_001",
      "description": "MRI lumbar spine w/o contrast",
      "cpt_code": "72148",
      "date": "2026-01-15",
      "key_findings": "Herniation at L4-L5",
      "status": "completed",
      "source_pages": [8]
    },
    {
      "id": "missing_001",
      "description": "EMG",
      "status": "referenced_missing",
      "referenced_on_page": 7
    }
  ],
  "flags": [
    {
      "id": "contra_001",
      "type": "contradiction",
      "severity": "critical",
      "description": "Diabetes status contradicted across records",
      "explanation": "...",
      "suggested_action": "Verify current diabetes status with patient"
    },
    {
      "id": "gap_001",
      "type": "care_gap",
      "severity": "warning",
      "description": "No ophthalmology referral for diabetic patient",
      "suggested_action": "Refer ophthalmology for diabetic screening"
    }
  ],
  "suggested_next_steps": [
    "Verify current diabetes status with patient",
    "Refer ophthalmology for diabetic screening",
    "Request EMG results from referring provider",
    "Order follow-up HbA1c (last result 9.4%, 60 days ago)"
  ]
}
```

### Error Handling & Partial Failure

Each pass persists its intermediate output to a new `intake_passes` JSONB column on `ai_analysis` before proceeding to the next pass. This enables:
- **Debuggability:** inspect which pass produced bad output
- **Retry:** if Pass 3 fails, the Lambda can retry from Pass 3 using persisted Pass 1+2 results
- **Partial results:** frontend can show extracted entities (Pass 1) even if coding (Pass 2) fails

The `intake_status` column tracks progress:
- `pending` — Lambda invoked, not started
- `pass_1_complete` — entities extracted
- `pass_2_complete` — codes mapped
- `pass_3_complete` — contradictions detected
- `complete` — intake sheet composed
- `failed` — unrecoverable error (with error message in `intake_passes.error`)

If a pass fails after 2 retries within the Lambda, the status is set to the last successful pass. The frontend displays whatever data is available with a banner indicating incomplete processing.

## Database Changes

### Reference Table Loading Strategy

**ICD-10-CM codes (~70k rows):**
- Source: CMS annual release (public domain, free download from cms.gov)
- Format: CSV/Excel files released each October for the next fiscal year
- Initial load: SQL seed script (`setup_icd10_codes.sql`) that loads from a CSV file committed to the repo
- Annual update: Replace the CSV and re-run the seed script. New codes added, retired codes removed.

**CPT codes (~10k rows):**
- Source: AMA CPT code files. **Requires an AMA license.**
- For MVP: Use the free CMS HCPCS Level I file which includes CPT code numbers and short descriptions (sufficient for validation)
- Long-term: Evaluate AMA license ($500-1500/year for small organizations) for full descriptions
- Initial load: Same pattern as ICD-10 — SQL seed script from CSV

**HCC mapping:**
- Source: CMS HCC Risk Adjustment Model (public, published annually)
- Maps ICD-10 codes to HCC categories for risk adjustment flagging

### New Reference Tables

```sql
-- ICD-10-CM codes (loaded from CMS annual release, ~70k rows)
CREATE TABLE icd10_codes (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  category TEXT,
  is_billable BOOLEAN DEFAULT TRUE,
  is_hcc BOOLEAN DEFAULT FALSE,
  hcc_category TEXT
);

-- CPT codes (~10k rows)
CREATE TABLE cpt_codes (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  category TEXT
);

-- Indexes for text search
CREATE INDEX idx_icd10_description ON icd10_codes USING gin(to_tsvector('english', description));
CREATE INDEX idx_cpt_description ON cpt_codes USING gin(to_tsvector('english', description));
```

### Schema Modifications

```sql
-- New columns on ai_analysis
ALTER TABLE ai_analysis ADD COLUMN clinical_intake JSONB;
ALTER TABLE ai_analysis ADD COLUMN intake_status TEXT DEFAULT 'pending'
  CHECK (intake_status IN ('pending', 'pass_1_complete', 'pass_2_complete', 'pass_3_complete', 'complete', 'failed'));
ALTER TABLE ai_analysis ADD COLUMN intake_passes JSONB;
-- Note: no separate contradictions column — contradictions live inside clinical_intake.flags

-- Provider decisions table (tracks accept/reject/edit on intake items)
CREATE TABLE intake_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id TEXT REFERENCES documents(file_id),
  user_id UUID REFERENCES auth.users(id),
  item_type TEXT NOT NULL,  -- 'diagnosis', 'medication', 'workup', 'flag'
  item_id TEXT NOT NULL,    -- matches id in clinical_intake JSON
  action TEXT NOT NULL,     -- 'accepted', 'rejected', 'edited', 'dismissed'
  edited_value JSONB,       -- only populated for 'edited' action
  reason TEXT,              -- optional, for 'dismissed' flags
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(file_id, user_id, item_type, item_id)
);

-- RLS (consistent with all other tables)
ALTER TABLE intake_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own decisions or view public" ON intake_decisions
  FOR ALL USING (auth.uid() = user_id OR is_public = TRUE);

-- Sync is_public from documents (consistent with other child tables)
CREATE OR REPLACE FUNCTION sync_intake_decisions_public_status()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE intake_decisions SET is_public = NEW.is_public
  WHERE file_id = NEW.file_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_intake_decisions_public
  AFTER UPDATE OF is_public ON documents
  FOR EACH ROW EXECUTE FUNCTION sync_intake_decisions_public_status();

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_intake_decisions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER intake_decisions_updated_at
  BEFORE UPDATE ON intake_decisions
  FOR EACH ROW EXECUTE FUNCTION update_intake_decisions_updated_at();
```

## API Routes

All intake endpoints are handled as **separate Next.js route files** rather than adding to the existing `ai/[...path]/route.ts` catch-all (which is already very large). New route files:

- `frontend/src/app/api/ai/intake/[fileId]/route.ts` — GET intake data
- `frontend/src/app/api/ai/intake/[fileId]/decision/route.ts` — POST decisions (UPSERT semantics)
- `frontend/src/app/api/ai/intake/[fileId]/export/route.ts` — GET export

### GET /api/ai/intake/{fileId}

Returns the clinical intake sheet. Frontend polls on `intake_status` until `complete` (or displays partial results for intermediate statuses).

**Response:**
```json
{
  "intake_status": "complete",
  "clinical_intake": { ... },
  "decisions": [ ... ]
}
```

For partial results (e.g., `intake_status: "pass_1_complete"`), returns available data from `intake_passes`:
```json
{
  "intake_status": "pass_1_complete",
  "partial_data": {
    "entities": { ... }
  },
  "decisions": []
}
```

### POST /api/ai/intake/{fileId}/decision

Saves a provider's action on an intake item. Uses **UPSERT** semantics — if a decision already exists for this (file_id, user_id, item_type, item_id), it is updated. This allows providers to change their mind (e.g., accept → reject).

**Request:**
```json
{
  "item_type": "diagnosis",
  "item_id": "dx_001",
  "action": "accepted",
  "edited_value": null,
  "reason": null
}
```

### GET /api/ai/intake/{fileId}/export?format=csv|pdf

Generates export containing only accepted items. MVP ships with **CSV and PDF export only**. FHIR R4 export deferred to v1.1 unless a specific integration partner requires it.

**CSV** columns: Type | Code | Description | Status | Source Page | Confidence

**PDF** formatted report with source citations

## FHIR R4 Export (v1.1)

Deferred from MVP to reduce scope. When implemented:

- Export follows FHIR R4 Bundle specification (type: `collection`)
- Coding system URIs: `http://hl7.org/fhir/sid/icd-10-cm` for ICD-10, `http://www.ama-assn.org/go/cpt` for CPT
- Resources include `meta.source` indicating AI-assisted extraction
- `Provenance` resource documents the extraction pipeline
- `Patient` resource only included if patient demographics were extractable (graceful handling when not available)
- Output should pass FHIR R4 validation (test against official FHIR validator)

No inbound FHIR import — deferred to v2 alongside EHR integration.

## Frontend: Intake Tab

New tab added as a **separate component** `IntakeSheet.tsx`, lazy-loaded via `dynamic()` import (consistent with how `BodyMap3D.tsx` is handled). Registered in `ClinicalSummary.tsx` as tab ID `intake`.

### Layout

Five collapsible sections:

**1. Problem List**
- Rows: checkbox | ICD-10 code | description | status badge | source page links
- Click ICD-10 code → search modal for code editing with type-ahead against icd10_codes table
- Click source page → PDF viewer scrolls and highlights
- Ambiguous status items get an inline AI note (e.g., "Record says 'controlled' — still active?")
- HCC-relevant codes get a small badge

**2. Medications**
- Rows: name | dose | frequency | prescriber | source page
- Warning badges for: missing dose/frequency, no supporting diagnosis, potential interactions

**3. Completed Workup**
- Rows: description | CPT code | date | key findings | status icon
- Status: checkmark (completed with results) | X (referenced but missing)
- Missing items visually distinct (red/amber row)

**4. Missing Data Flags**
- Cards with severity color coding: red (critical), amber (warning), blue (info)
- Each card: type icon | description | explanation | suggested action
- Dismiss button with optional reason (creates intake_decision record)
- Contradictions show both source references side by side

**5. Suggested Next Steps**
- Simple checklist derived from flags
- Each step links back to the flag that generated it

### Export Dropdown
Top-right button with options: CSV, PDF Report (FHIR added in v1.1)

### Interaction: Source Highlighting
When a user clicks any source page reference, the PDF viewer (left pane in SplitPane layout):
1. Navigates to the referenced page
2. Highlights the relevant text span (if available via BoundingBoxOverlay)

### Partial Processing State
If `intake_status` is not `complete`, the tab shows:
- A progress indicator showing which pass is in progress
- Available data from completed passes (e.g., entity list from Pass 1)
- A banner: "Intake sheet is still processing. Showing partial results."

## Infrastructure: clinical_intake Lambda

### Configuration
- **Runtime:** Python 3.11
- **Memory:** 512 MB
- **Timeout:** 900 seconds (15 min — 4 Gemini passes with batched validation, allows headroom for large documents)
- **Layer:** shared_layer (google-generativeai, supabase)
- **Environment:** GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

### Terraform Addition
New Lambda function + IAM role, added as a new step in the existing Step Functions state machine after compute_embeddings.

## Cost Estimate

Per 20-page document (typical case):
- Gemini 2.5 Flash Lite — Pass 1: ~$0.005, Pass 2: ~$0.003, Pass 3: ~$0.005, Pass 4: ~$0.002
- Pass 2 validation re-prompt (if needed): ~$0.003
- Supabase queries: negligible
- Lambda compute: ~$0.002
- **Typical total: ~$0.02 per document**

Per 100-page document (worst case):
- Pass 1 chunked (10 chunks + merge): ~$0.04
- Pass 2 with large entity set + re-prompts: ~$0.02
- Pass 3 + Pass 4: ~$0.02
- **Worst case total: ~$0.08 per document**

## Deferred to v2

- GLiNER NER model for higher-accuracy entity extraction
- Full agent architecture with iterative reasoning and tool use
- HL7 FHIR inbound import from EHRs
- FHIR R4 export (deferred to v1.1)
- Prior authorization letter generation
- SOAP note drafting from encounter notes
- Cross-document longitudinal patient profiles
- Drug interaction database integration
