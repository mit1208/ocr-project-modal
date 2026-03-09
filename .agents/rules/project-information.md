---
trigger: always_on
---

# Project Overview: Medical OCR & 3D Analysis Platform

This project is a sophisticated medical document analysis platform that transforms raw clinical PDFs into structured data, provides AI-driven clinical insights, and visualizes findings on an interactive 3D body map.

---

## 🏗️ System Architecture

### 1. The AI OCR Pipeline (AWS Step Functions)
The core of the system is an automated pipeline triggered by S3 uploads (`uploads/` prefix).
- **Trigger**: S3 Object Created -> EventBridge -> Step Function.
- **Workflow Steps**:
    1. **pdf_split**: Counts pages and prepares processing chunks.
    2. **invoke_ocr**: High-performance OCR powered by **Modal (FastAPI)**. Extracts text from each page.
    3. **analyze_document**: Uses **Gemini AI** to perform clinical extraction, identifying:
        - Patients (Name, DOB, Chief Complaint, Summary).
        - Critical Flags (Life-threatening issues).
        - Abnormal Findings (Lab results, imaging notes).
        - Clinical Timelines.
    4. **compute_embeddings**: Generates vector embeddings (Gemini) for chunks of text to enable RAG (Retrieval-Augmented Generation).

### 2. Interactive 3D Body Map
A specialized visualization tool for clinical findings.
- **Backend (Lambda + API Gateway)**: 
    - Fetches clinical findings for a specific `file_id`.
    - Maps findings to anatomical regions using Gemini.
    - Path: `/body-map/{file_id}` (HTTP GET).
- **Frontend (Three.js / React Three Fiber)**:
    - Renders an anatomical model (`body.glb`).
    - Highlights regions based on severity (Critical: Red, Abnormal: Amber, Normal: Green).
    - Features pulsing animations for critical areas.

### 3. Voice Assistant & RAG
- **RAG**: Uses **Supabase pgvector** to perform semantic search across document chunks.
- **Assistant**: An AI-driven interface that allows users to query documents using natural language.

---

## 🛠️ Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | Next.js, React Three Fiber (Three.js), Tailwind CSS |
| **Infrastructure** | Terraform, AWS (Lambda, S3, Step Functions, EventBridge, API Gateway) |
| **OCR Backend** | Modal (FastAPI / High-performance compute) |
| **AI Models** | Google Gemini (Analysis, Embeddings, Location Mapping) |
| **Database** | Supabase (Postgres, pgvector, Realtime, Auth, RLS) |
| **Language** | TypeScript (Frontend), Python (Lambdas) |

---

## 🗄️ Database Schema

### `documents`
- Root table for uploaded files. Stores metadata, `case_id`, and `file_id`.
- Controls visibility (`is_public`) which propagates to all child tables via triggers.

### `ocr_results`
- Stores raw text extracted from each page of a document.

### `ai_analysis`
- Stores the structured output from Gemini.
- Columns include `patients`, `critical_flags`, `abnormal_findings`, `groups`, and `body_map_regions` (cached mapping for the 3D map).

### `document_chunks`
- Stores document segments with their corresponding `vector(768)` embeddings for semantic search.

---

## 📂 Key File Locations

- `/frontend/src/components/BodyMap3D.tsx`: Core 3D visualization logic.
- `/infrastructure/main.tf`: Terraform definition of AWS resources.
- `/infrastructure/body_map/lambda_function.py`: Lambda that maps text to 3D coordinates.
- `/infrastructure/analyze_document/lambda_function.py`: Primary medical analysis logic.
- `/setup_*.sql`: Database schema and RLS policies for Supabase.

---

## 🚀 Future Development Notes

- **Polling**: The frontend implements polling on the `/body-map/{file_id}` endpoint while the pipeline is running (indicated by a 404 response).
- **Security**: Supabase Row Level Security (RLS) is enabled on all tables, ensuring users only see their own data unless marked as public.
- **Regions**: Anatomy mapping is standardized to a specific set of keys (e.g., `left_lung`, `head`, `lower_spine`) to match the 3D model's mesh names.
