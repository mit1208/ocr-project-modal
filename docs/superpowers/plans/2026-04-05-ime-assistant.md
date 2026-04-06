# IME Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-pass IME workspace to the medical document analysis app with two connected experiences: a consultation assistant that captures structured interview notes and a guided IME summary builder that generates, refines, stores, and exports sectioned reports.

**Architecture:** Keep the current case-review shell intact and extend it with two new workspaces inside the existing right-side analysis pane. Persist consultation and IME data in new Supabase tables with standard per-user RLS. Use authenticated Next.js route handlers for all new operations. Reuse Gemini 2.5 Flash for live consultation summarization, gap detection, IME section generation, and section chat refinement. Reuse `pdf-lib` for PDF export in this first pass.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS 4, TypeScript, Supabase, Gemini 2.5 Flash, pdf-lib

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `setup_ime_tables.sql` | Create | Consultation + IME schema, triggers, indexes, RLS |
| `frontend/src/lib/server/ime.ts` | Create | Shared IME types, prompts, Supabase/Gemini helpers |
| `frontend/src/app/api/consultation/[sessionId]/route.ts` | Create | Consultation session CRUD + transcript ingestion |
| `frontend/src/app/api/consultation/stream/route.ts` | Create | WebSocket upgrade stub + route contract |
| `frontend/src/app/api/ime/[caseId]/route.ts` | Create | IME summary create/load/update |
| `frontend/src/app/api/ime/[caseId]/section/[type]/route.ts` | Create | Generate/regenerate one IME section |
| `frontend/src/app/api/ime/[caseId]/section/[type]/chat/route.ts` | Create | Refine one IME section with chat |
| `frontend/src/app/api/ime/[caseId]/export/route.ts` | Create | IME export response |
| `frontend/src/app/api/ime/preferences/route.ts` | Create | Preference CRUD |
| `frontend/src/app/api/ime/templates/route.ts` | Create | Template CRUD |
| `frontend/src/components/ConsultationAssistant.tsx` | Create | Session controls, transcript, live summary, suggested questions |
| `frontend/src/components/IMESummaryBuilder.tsx` | Create | Guided section workflow, approval state, section chat |
| `frontend/src/components/IMEExport.tsx` | Create | Export controls and summary metadata |
| `frontend/src/components/IMEPreferences.tsx` | Create | Preference/template management panel |
| `frontend/src/components/ClinicalSummary.tsx` | Modify | Add IME and consultation tabs and mount new components |
| `frontend/src/components/SplitPane.tsx` | Modify | Pass case context into ClinicalSummary |
| `frontend/src/app/page.tsx` | Modify | Pass `caseId` into SplitPane when present |

---

## Task 1: Data Model and Plan Tracking

**Files:**
- Create: `docs/superpowers/plans/2026-04-05-ime-assistant.md`
- Create: `setup_ime_tables.sql`

- [ ] Add the tracked plan document with scope, file map, and task checklist.
- [ ] Add consultation, transcript, summary, IME summary, section chat, preference, and template tables.
- [ ] Add updated-at triggers, useful indexes, and per-user RLS policies aligned with the current repo.

## Task 2: Shared Server Foundation

**Files:**
- Create: `frontend/src/lib/server/ime.ts`

- [ ] Centralize IME section definitions, consultation checklist items, payload types, and prompt helpers.
- [ ] Reuse authenticated Supabase access for new routes.
- [ ] Add Gemini helpers for JSON and rich-text generation with safe fallback parsing.
- [ ] Add helpers to gather case documents, AI analysis, chronology, and consultation context into a single generation payload.

## Task 3: Consultation APIs

**Files:**
- Create: `frontend/src/app/api/consultation/[sessionId]/route.ts`
- Create: `frontend/src/app/api/consultation/stream/route.ts`

- [ ] Implement session create/load/update with transcript persistence.
- [ ] Support appending transcript segments and recomputing the rolling structured summary plus suggested questions.
- [ ] Return a clear 426/contract response for the future WebSocket endpoint while keeping the route path reserved.

## Task 4: IME Builder APIs

**Files:**
- Create: `frontend/src/app/api/ime/[caseId]/route.ts`
- Create: `frontend/src/app/api/ime/[caseId]/section/[type]/route.ts`
- Create: `frontend/src/app/api/ime/[caseId]/section/[type]/chat/route.ts`
- Create: `frontend/src/app/api/ime/[caseId]/export/route.ts`
- Create: `frontend/src/app/api/ime/preferences/route.ts`
- Create: `frontend/src/app/api/ime/templates/route.ts`

- [ ] Implement summary create/load/update and section approval persistence.
- [ ] Generate section drafts from documents, AI analysis, chronology, and consultation context.
- [ ] Support per-section chat refinement with stored chat history.
- [ ] Support exportable PDF output for the assembled IME summary in the first pass.
- [ ] Support user preference and template CRUD for future prompt steering.

## Task 5: Consultation and IME UI

**Files:**
- Create: `frontend/src/components/ConsultationAssistant.tsx`
- Create: `frontend/src/components/IMESummaryBuilder.tsx`
- Create: `frontend/src/components/IMEExport.tsx`
- Create: `frontend/src/components/IMEPreferences.tsx`

- [ ] Build a consultation workspace with record/pause/stop controls, session timer, speaker role toggle, transcript entry, live summary, and suggested questions.
- [ ] Build a guided IME section workflow with generate, refine, approve, reset, and export affordances.
- [ ] Build preference/template management in a compact panel suitable for the existing analysis layout.

## Task 6: App Integration and Verification

**Files:**
- Modify: `frontend/src/components/ClinicalSummary.tsx`
- Modify: `frontend/src/components/SplitPane.tsx`
- Modify: `frontend/src/app/page.tsx`

- [ ] Add `Consultation` and `IME Builder` tabs to the current analysis workspace.
- [ ] Pass `caseId` into the right-side analysis pane so the IME builder can operate at case scope.
- [ ] Verify the new code with lint and fix any type or import regressions.
