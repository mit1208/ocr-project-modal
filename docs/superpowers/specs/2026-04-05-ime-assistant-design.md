# IME Assistant Platform — Design Spec

## Overview

Two interconnected features for the medical document analysis platform that help case managers and paralegals generate Independent Medical Examination (IME) summaries. A real-time consultation assistant captures doctor-patient conversations, and a guided IME summary builder produces structured, exportable reports — both powered by a learning system that improves with use.

## Feature 1: Real-Time Consultation Assistant

### Purpose

During an in-person doctor-patient consultation, the assistant listens via the device microphone, produces a live transcript with speaker diarization, maintains a rolling structured summary, and suggests questions the doctor should ask to ensure all IME-relevant information is captured.

### Audio Pipeline

- Browser `MediaRecorder` API captures mic input as audio chunks
- Chunks stream via WebSocket to `/api/consultation/stream`
- Backend proxies to **Deepgram Nova-2** streaming API (chosen for real-time accuracy + built-in speaker diarization)
- User labels which speaker is doctor vs patient at session start (or system infers after a few exchanges)

### Real-Time Processing

- Transcribed segments (with speaker labels) arrive every ~1-2 seconds
- Transcript batched in ~10-15 second windows (or on speaker turn changes) before sending to Gemini
- Two parallel Gemini jobs per batch:
  1. **Live Summary Update** — sliding context window (latest summary + recent transcript delta) maintains structured summary under headings: Chief Complaint, History of Present Illness, Current Symptoms, Functional Limitations, Patient-Reported History
  2. **Gap Detection & Question Suggestions** — runs on a ~30s cadence, compares discussed topics against an IME requirements checklist (see below), surfaces prioritized questions

### IME Requirements Checklist (for Gap Detection)

The question suggestion engine tracks coverage of these categories:

- Date and mechanism of injury
- Pre-existing conditions for affected body regions
- Current symptoms (pain levels, frequency, triggers)
- Functional limitations (ADLs, work capacity, mobility)
- Treatment history and current treatment plan
- Medication history (current and past, including response)
- Diagnostic imaging and test results discussed
- Patient's subjective account of progress/regression
- Work status and occupational demands
- Prior injuries or claims to the same body region

Items are marked as "covered" when the LLM detects relevant discussion in the transcript. Remaining uncovered items are surfaced as suggested questions, prioritized by IME relevance.

### UI Layout

- **Left panel:** Live transcript, color-coded by speaker
- **Right panel:** Two tabs — Live Summary (auto-updating) and Suggested Questions (prioritized list, items dismiss as topics are covered)
- **Bottom bar:** Record/pause/stop controls, session timer, speaker label toggle

### Scalability

- Deepgram handles transcription load as a managed service
- WebSocket proxy is stateless per-session — scales with serverless (API Gateway WebSocket + Lambda or Fargate)
- LLM calls bounded to ~2-4 per minute per session via batching + sliding window
- Transcript segments are append-only writes — no contention
- Audio chunks are NOT stored server-side by default (only transcript). Optional S3 storage for compliance/audit.

## Feature 2: IME Summary Builder

### Purpose

A guided wizard that walks the user through each section of an IME summary. For each section, the LLM generates a draft from all available sources, the user reviews and refines via chat, then moves to the next section. The final summary is exportable as PDF or Word.

### Guided Wizard Sections

Order adapts based on available data. Each section follows: LLM draft → user review → chat refinement → approve → next.

1. **Patient Demographics & History** — pulled from documents + consultation transcript
2. **Records Reviewed** — auto-generated list of all uploaded documents with types, dates, providers
3. **Mechanism of Injury** — extracted from records, enriched with patient's verbal account if consultation exists
4. **Current Complaints & Functional Limitations** — heavily weighted toward consultation data when available, falls back to document analysis
5. **Relevant Diagnoses & Treatment Timeline** — reuses existing chronology + timeline analysis, organized for IME context
6. **Pre-Existing Conditions Assessment** — cross-references historical records against injury-related findings
7. **Suggested IME Physician Questions** — generated based on gaps, contradictions, and ambiguities detected across all sources

### Page-Level Source Tracking

Every claim in the IME summary is grounded with page references from the source documents:

- **Section generation:** LLM receives relevant pages via vector search (`match_document_chunks`) rather than full documents. Each statement cites source page(s) inline, e.g., *"MRI showed L4-L5 herniation (Doc 3, p. 12)"*
- **Chat refinement:** When a user references a specific page, the system fetches that page's OCR text directly from `ocr_results` for targeted context
- **Transcript-to-document cross-referencing:** When the consultation transcript mentions findings from records, the system uses semantic matching against `document_chunks` embeddings to link transcript segments to relevant document pages
- **Export:** Final PDF/Word includes inline citations and a "Sources" appendix mapping each citation to document name + page number
- **Performance benefit:** Fetching specific pages via `pageIndex` instead of sending full documents reduces token usage by ~60-80% per LLM call and improves factual accuracy by narrowing context

### Document-Type Adaptation

- System detects document types from existing analysis (radiology, surgical notes, therapy records, pharmacy, etc.)
- Section prompts adjust accordingly (e.g., radiology present → diagnoses section emphasizes imaging findings)
- Sections with no relevant source data are flagged as "insufficient data" rather than hallucinated

### Chat Refinement per Section

- Each section has a contextual chat input
- User can request: conciseness, additions from specific pages, corrections, tone changes
- LLM regenerates only that section, preserving approved sections
- Chat history per section is preserved for backtracking

### The Bridge: Consultation → IME Summary

When a consultation session exists for a case, the IME builder automatically incorporates the transcript and live summary as additional context. This provides information no document contains — patient's own words, doctor's observations, verbal history. Both features work independently; the consultation enriches the summary when available.

### Export

- PDF (extending existing PDF builder pattern) and Word (via `docx` npm package)
- Exported document includes: header with case info, all sections with source references (page numbers), and a "records reviewed" appendix
- Saved as a versioned artifact in-platform, tied to the case

## Feature 3: Learning System

Three layers of adaptation, all scoped per-user (no cross-user data sharing).

### Layer 1: Session Steering (Ephemeral)

- As the user edits/accepts/rejects content within a session, a `steeringContext` object accumulates preferences
- Examples: user shortens verbose section → notes "prefer concise"; user adds ICD-10 codes → notes "include ICD-10 codes"
- Context appended to system prompt for subsequent LLM calls in that session
- No persistence — resets each session

### Layer 2: User Preference Store (Persistent)

- After each session, system analyzes diffs between generated drafts and final approved versions
- Patterns repeating across 2+ sessions become preferences with increasing confidence scores
- Stored in `user_ime_preferences` table:
  - `preference_key` examples: `tone`, `always_include`, `section_detail_levels`
  - `confidence` (float): increases with consistent reinforcement, decays if contradicted
- Preferences above a confidence threshold are injected into system prompts for future sessions
- Users can view, edit, and delete preferences via a settings page

### Layer 3: Template Evolution (Persistent)

- After 3+ completed IME summaries, system proposes a personalized template based on common patterns
- Example: "You consistently add a 'Vocational Impact' section and prefer high detail on diagnoses. Save this as your default template?"
- Users can accept, modify, or create multiple named templates (e.g., "Ortho IME", "Neuro IME")
- Templates stored in `ime_templates` table with ordered section configs
- "Reset learning" button clears all preferences and templates

## Data Model

### New Tables

All tables follow existing RLS pattern: `auth.uid() = user_id`.

#### `consultation_sessions`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `case_id` | text | FK to documents |
| `user_id` | uuid | FK to auth.users |
| `started_at` | timestamptz | |
| `ended_at` | timestamptz | nullable |
| `status` | text | recording / paused / completed |
| `speaker_labels` | jsonb | e.g., `{"speaker_0": "doctor", "speaker_1": "patient"}` |

#### `consultation_transcript`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `session_id` | uuid | FK to consultation_sessions |
| `sequence` | integer | ordering |
| `speaker` | text | doctor / patient |
| `text` | text | transcript segment |
| `timestamp` | float | seconds from session start |

#### `consultation_summary`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `session_id` | uuid | FK to consultation_sessions |
| `summary_json` | jsonb | structured summary under headings |
| `suggested_questions_json` | jsonb | current question suggestions |
| `version` | integer | increments on each update |
| `is_final` | boolean | true when session ends |

#### `ime_summaries`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `case_id` | text | FK to documents |
| `user_id` | uuid | FK to auth.users |
| `consultation_session_id` | uuid | nullable FK to consultation_sessions |
| `status` | text | draft / in_progress / completed |
| `sections` | jsonb | ordered section data with approval status |
| `template_id` | uuid | nullable FK to ime_templates |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

#### `ime_section_chats`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `ime_summary_id` | uuid | FK to ime_summaries |
| `section_type` | text | e.g., demographics, diagnoses |
| `messages` | jsonb | array of `{role, content, timestamp}` |
| `updated_at` | timestamptz | |

#### `user_ime_preferences`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `user_id` | uuid | FK to auth.users |
| `preference_key` | text | e.g., tone, always_include |
| `preference_value` | jsonb | preference data |
| `confidence` | float | 0.0 - 1.0 |
| `updated_at` | timestamptz | |

#### `ime_templates`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `user_id` | uuid | FK to auth.users |
| `name` | text | e.g., "Ortho IME" |
| `sections` | jsonb | ordered list of section configs |
| `is_default` | boolean | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### New API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/consultation/stream` | WebSocket | Real-time audio streaming + transcript |
| `/api/consultation/[sessionId]` | GET/POST/PATCH | Consultation session CRUD |
| `/api/ime/[caseId]` | GET/POST | IME summary CRUD |
| `/api/ime/[caseId]/section/[type]` | POST | Generate/regenerate a section |
| `/api/ime/[caseId]/section/[type]/chat` | POST | Chat refinement for a section |
| `/api/ime/[caseId]/export` | POST | Export as PDF or Word |
| `/api/ime/preferences` | GET/PUT/DELETE | User preference management |
| `/api/ime/templates` | GET/POST/PUT/DELETE | Template CRUD |

### New Frontend Components

| Component | Purpose |
|-----------|---------|
| `ConsultationAssistant.tsx` | Real-time consultation UI (transcript, summary, suggestions) |
| `IMESummaryBuilder.tsx` | Guided wizard with per-section chat refinement |
| `IMEExport.tsx` | Export preview and format selection |
| `IMEPreferences.tsx` | User preference and template management |

## Technology Choices

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Real-time transcription | Deepgram Nova-2 | Best streaming accuracy + built-in speaker diarization |
| LLM (analysis + generation) | Gemini 2.5 Flash | Consistent with existing pipeline, large context window |
| PDF export | Extend existing `buildPdf()` | Reuse existing infrastructure |
| Word export | `docx` npm package | Lightweight, well-maintained |
| Audio capture | Browser MediaRecorder API | No additional dependencies |
| WebSocket | Next.js API route or API Gateway | Depends on deployment constraints |

## Privacy & Security

- All data scoped per-user via Supabase RLS
- Audio is not stored by default — only transcripts persist
- Optional S3 audio storage behind explicit user opt-in (for compliance/audit)
- User preferences and templates are fully user-controlled (view, edit, delete, reset)
- No cross-user data sharing at any layer
