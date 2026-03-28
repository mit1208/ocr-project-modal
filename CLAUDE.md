# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Medical document analysis platform: users upload PDFs, which are OCR'd and analyzed by AI to produce clinical summaries, chronologies, body map visualizations, and voice-interactive Q&A. The system uses a serverless pipeline (AWS Step Functions) orchestrating Lambda functions, with a Next.js frontend and Modal-hosted OCR backend.

## Architecture

**Three independent deployable units:**

- **frontend/** — Next.js 16 app (App Router, React 19, Tailwind CSS 4, TypeScript)
- **backend/** — Modal Python app running LightOnOCR-2-1B on GPU
- **infrastructure/** — Terraform-managed AWS resources (Lambdas, Step Functions, S3, EventBridge, API Gateway)

**Database:** Supabase PostgreSQL with RLS, pgvector for embeddings. Schema files are `setup_*.sql` at repo root.

### Document Processing Pipeline

S3 upload → EventBridge → Step Functions → `pdf_split` (8-page chunks) → parallel `invoke_ocr` (Modal OCR API, max 2 concurrent) → `index_document` → `analyze_document` (Gemini 2.5-Flash, 2-pass chunked analysis) → `compute_embeddings` (768-dim vectors). Frontend polls for completion.

### Key API Routes (frontend/src/app/api/)

- `upload-url/` — generates S3 presigned PUT URLs, pre-creates document record
- `pdf-url/` — generates S3 presigned GET URLs for viewing
- `ai/[...path]/` — AI analysis, chronology generation (Gemini 2.5-Flash)
- `voice-qa/` — WebSocket stub for voice interaction

### Frontend Components of Note

- `ClinicalSummary.tsx` (~1500 lines) — main analysis display, the largest component
- `BodyMap3D.tsx` — Three.js/React Three Fiber 3D body visualization
- `VoiceAssistant.tsx` — voice Q&A with Gemini TTS

### Database Tables

`documents`, `ocr_results`, `ai_analysis`, `document_chunks` (pgvector), `case_settings`, `chronology_versions`. All use RLS with `auth.uid() = user_id OR is_public = TRUE` pattern. Public status propagates from documents to child tables via triggers.

## Common Commands

### Frontend
```bash
cd frontend
npm run dev          # Start dev server (Turbopack)
npm run build        # Production build
npm run lint         # ESLint
```

### Backend (Modal OCR)
```bash
cd backend
modal deploy deploy.py   # Deploy to Modal
modal run deploy.py      # Test locally
```

### Infrastructure
```bash
cd infrastructure
make init       # terraform init
make plan       # terraform plan
make deploy     # terraform apply -auto-approve
make destroy    # terraform destroy
make clean      # remove ZIP artifacts
make reset      # clean + init + deploy
```

## Environment Variables

**Frontend** (`frontend/.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `GEMINI_API_KEY`, `MODAL_API_URL`

**Infrastructure** (`infrastructure/terraform.tfvars`): `modal_api_url`, `ocr_key`, `supabase_url`, `supabase_service_role_key`, `gemini_api_key`

## Key Patterns

- **Path alias:** `@/*` maps to `frontend/src/*`
- **AI model used throughout:** Gemini 2.5-Flash (analysis, embeddings, TTS)
- **OCR model:** LightOnOCR-2-1B via Modal (A10G GPU)
- **Deployment targets:** Frontend on Vercel, backend on Modal, infra on AWS us-east-1
- **CORS origins:** `localhost:3000` and `https://medical-document-chat.vercel.app`
- **Lambda layers:** `shared_layer` (google-generativeai, supabase) and `ocr_vendor_layer` (PyMuPDF, PyPDF2)
- **Embedding dimensions:** 768 with IVFFlat cosine similarity index
