# SLM Per-User Fine-Tuning with GRPO Reinforcement Learning

## Overview

Fine-tune Qwen3-0.6B per-user on their uploaded PDF content, then continuously improve it via GRPO reinforcement learning with Gemini-as-judge. No RAG at inference time — the model internalizes document knowledge directly.

Completely separate from the existing AWS OCR/analysis pipeline. All new infrastructure runs on GCP. Existing code is untouched except for new frontend API routes and a "Train My Model" button.

**Note on knowledge internalization**: A 0.6B model with LoRA will not perfectly memorize every fact from hundreds of pages. The goal is to capture the most frequently relevant patterns and relationships. If internalization proves insufficient for certain query types, a lightweight retrieval fallback can be added later — but we start without RAG to validate how far pure fine-tuning goes.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    EXISTING PIPELINE (unchanged)             │
│  PDF Upload → S3 → Step Functions → OCR → Analyze → Embed   │
└──────────────────────────┬──────────────────────────────────┘
                           │ OCR text stored in Supabase
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 NEW: SLM TRAINING PIPELINE                   │
│                                                              │
│  Phase 1: Knowledge Injection (user-triggered, once)         │
│  ┌──────────┐    ┌───────────────┐    ┌──────────────────┐  │
│  │ OCR Text  │───▶│ Gemini 2.5    │───▶│ SFT Fine-tune    │  │
│  │ + AI      │    │ Generate Q&A  │    │ Qwen3-0.6B+LoRA  │  │
│  │ Analysis  │    │ pairs         │    │ (GCP Job)         │  │
│  └──────────┘    └───────────────┘    └───────┬──────────┘  │
│                                               │              │
│                                    LoRA adapter → GCS        │
│                                               │              │
│  Phase 2: GRPO RL Loop (quality-gated)        ▼              │
│  ┌──────────┐    ┌───────────────┐    ┌──────────────────┐  │
│  │ User asks │───▶│ SLM generates │───▶│ Gemini scores    │  │
│  │ question  │    │ K=4 responses │    │ each response    │  │
│  └──────────┘    └───────────────┘    └───────┬──────────┘  │
│                                               │              │
│                  ┌───────────────┐    ┌────────▼─────────┐  │
│                  │ Update LoRA   │◀───│ GRPO advantages  │  │
│                  │ + SFT on gold │    │ + OPD distill    │  │
│                  │ (GCP Job)     │    │ (combined loss)  │  │
│                  └───────────────┘    └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Phase 1: Knowledge Injection

### Trigger
User clicks "Train My Model" button in the frontend. Calls `/api/slm/train` which hits the GCP `slm-trainer` Cloud Run service.

**Job deduplication**: Enforced atomically at the database level with a partial unique index: `CREATE UNIQUE INDEX ON slm_models (user_id) WHERE status = 'training'`. The trainer inserts a row with status='training' — if one already exists for the user, the insert fails and the request is rejected with "training already in progress". This prevents race conditions from double-clicks or concurrent requests.

### Step 1 — Gather Training Data
- `slm-trainer` fetches all OCR text for the user from Supabase `ocr_results` table
- Also pulls `ai_analysis` data (clinical summaries, timelines, findings) for richer context

### Step 2 — Gemini Generates Synthetic Q&A Pairs
- Chunks OCR text per document
- Gemini 2.5-Flash generates diverse Q&A pairs per chunk:
  - Factual: "What was the patient's blood pressure on March 3?"
  - Reasoning: "What trend do the lab results show?"
  - Cross-document: "How does the diagnosis in Report A relate to findings in Report B?"
- Target: ~100-500 pairs per user depending on document volume
- Stored in `slm_training_data` table with source='gemini_synthetic'

### Step 3 — SFT with LoRA
- GCP Cloud Run Jobs with L4 GPU
- Base model: Qwen/Qwen3-0.6B from HuggingFace
- LoRA config: rank 16, alpha 32, target modules (q_proj, v_proj)
- Training: 3-5 epochs, learning rate ~2e-4
- Output: LoRA adapter (~10-50MB) saved to GCS bucket
- Registered in `slm_models` table (user_id, adapter_path, version=1, status='ready')

**Failure handling**: Training job writes `slm_models` row with status='training' at start. On success → 'ready'. On failure → 'failed'. Previous adapter version is never overwritten — each version gets its own GCS path. If training fails, the previous 'ready' version remains active.

**Resource limits**: Maximum 5,000 pages of OCR text per training job. Maximum 500 Q&A pairs generated. Excess documents are sampled by recency. Only 1 concurrent training job per user (enforced by dedup check).

## Phase 2: GRPO Reinforcement Learning with Combined Training

### Step 1 — Inference + K-Response Generation
- User asks question via `/api/slm/query`
- `slm-server` loads base Qwen3-0.6B + user's latest LoRA adapter
- Generates K=4 candidate responses (temperature=0.6)
- **Response selection (synchronous)**: Best response selected by SLM log-probability (highest average token log-prob) — no Gemini call needed at inference time. This keeps latency low.
- Gemini scoring happens async in the background for training purposes only
- **Rate limit**: Max 20 queries/minute per user on `/api/slm/query`. Prevents unbounded Gemini scoring costs from spam or bots.

### Step 2 — Gemini-as-Judge (async, background)
- `slm-server` fires async HTTP call to `slm-scorer` with the query + K responses
- **BM25 document targeting**: `slm-scorer` maintains an in-memory BM25 index per user, built from OCR text chunks stored in Supabase. Index is built on first request and cached with a document count check — if the user's document count in Supabase differs from the cached index, it rebuilds automatically. Rebuilt on cold start (~2-3 seconds for typical user). Identifies top-3 relevant document sections to provide Gemini with scoring context.
- Gemini 2.5-Flash scores each response (1-5 scale) on:
  - **Accuracy** — matches document content
  - **Completeness** — fully answers the question
  - **Coherence** — well-structured
- Scores stored in `slm_feedback` table
- **OPD Enhancement**: If best-of-K score < 4.0, Gemini also generates a gold (correct) response → stored in `slm_training_data` with source='gemini_correction'

### Step 3 — Quality Gate
- Running average of best-of-K scores tracked per user
- Retraining triggers when:
  - Average score drops below 3.0/5, OR
  - 50+ scored interactions accumulate since last training (ensures periodic improvement even with good scores)
- These thresholds are configurable and stored in `slm_models.training_config`. Initial values are starting points to be tuned based on observed behavior.

### Step 4 — GRPO + OPD Combined Training Job
- For each stored interaction: K responses with Gemini scores
- **GRPO**: Compute group-relative advantages: `advantage_i = (score_i - mean(scores)) / std(scores)`
- Apply PPO-style clipped surrogate loss
- **OPD Distillation**: SFT loss on gold responses (Gemini corrections)
- **Combined loss**: 0.7 * GRPO_loss + 0.3 * SFT_loss (configurable in `training_config`, needs tuning per deployment)
- Update LoRA adapter, save new version to GCS
- Bump version in `slm_models`
- **Rollback safety**: After training, run a quick validation (10 held-out Q&A pairs from Phase 1 data). If new version scores worse than previous, mark as 'failed' and keep old version active. Log the regression in `slm_eval_snapshots`.

### Step 5 — Redeploy
- `slm-server` checks `slm_models` for latest version with status='ready' on each request
- Adapter is downloaded from GCS and cached in instance memory
- On cold start: base model loads from GCS-cached copy (~5s), then adapter loads (~1s)

## GCP Cloud Run Services

| Service | Purpose | GPU | Trigger |
|---|---|---|---|
| `slm-trainer` | Phase 1 SFT + Phase 2 GRPO training | L4 GPU | HTTP from frontend |
| `slm-server` | Load base model + LoRA, serve inference | L4 GPU | HTTP from frontend |
| `slm-scorer` | Background Gemini scoring + BM25 matching | No GPU | Async from slm-server |

**Authentication**: All GCP services authenticate to Supabase using the service role key (bypasses RLS), stored in GCP Secret Manager. Frontend API routes pass the authenticated `user_id` from the Supabase session to GCP services — GCP services trust this because the Next.js API route has already verified the session. GCP Cloud Run services are invoked with IAM-authenticated HTTP (service account), not publicly exposed.

**Adapter serving strategy**: `slm-server` keeps the base Qwen3-0.6B model loaded persistently. LoRA adapters are small (10-50MB) and loaded/swapped per request based on `user_id`. Multiple user adapters can coexist in L4 GPU memory (24GB) — the base model uses ~1.6GB, each LoRA adapter ~50MB, so 100+ concurrent adapters fit easily.

## Frontend API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/slm/train` | POST | "Train My Model" button → calls `slm-trainer` |
| `/api/slm/query` | POST | Question → `slm-server` K responses → return best |
| `/api/slm/status` | GET | Poll training job status |
| `/api/slm/models` | GET | List user's model versions |

## Database Schema (New Supabase Tables)

### `slm_training_data`
| Column | Type | Notes |
|---|---|---|
| id | UUID, PK | |
| user_id | UUID, FK → auth.users | |
| file_ids | TEXT[] | Source document(s) — array for cross-document pairs |
| question | TEXT | |
| answer | TEXT | |
| source | TEXT | 'gemini_synthetic' \| 'gemini_correction' \| 'user_feedback' |
| created_at | TIMESTAMP | |

### `slm_models`
| Column | Type | Notes |
|---|---|---|
| id | UUID, PK | |
| user_id | UUID, FK → auth.users | |
| version | INTEGER | UNIQUE(user_id, version) |
| adapter_path | TEXT | GCS path to LoRA adapter |
| status | TEXT | 'training' \| 'ready' \| 'failed' |
| base_model | TEXT | 'Qwen/Qwen3-0.6B' |
| training_config | JSONB | LoRA rank, epochs, etc. |
| created_at | TIMESTAMP | |

### `slm_feedback`
| Column | Type | Notes |
|---|---|---|
| id | UUID, PK | |
| user_id | UUID, FK → auth.users | |
| query | TEXT | |
| doc_refs | TEXT[] | BM25-matched document IDs |
| responses | JSONB | Array of K generated responses |
| scores | JSONB | Gemini scores per response |
| gold_response | TEXT, nullable | Gemini correction when best < 4.0 |
| model_version | INTEGER | Which LoRA version generated this |
| response_time_ms | INTEGER | SLM inference latency |
| token_count | INTEGER | Response length |
| used_in_training | BOOLEAN, default false | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | Set when used_in_training flips |

### `slm_eval_snapshots`
| Column | Type | Notes |
|---|---|---|
| id | UUID, PK | |
| user_id | UUID, FK → auth.users | |
| model_version | INTEGER | |
| eval_type | TEXT | 'auto_benchmark' \| 'grpo_cycle' \| 'manual' |
| avg_score | FLOAT | |
| score_distribution | JSONB | {1: count, 2: count, ...} |
| total_queries | INTEGER | |
| gold_response_rate | FLOAT | % needing Gemini correction |
| avg_response_time_ms | FLOAT | |
| created_at | TIMESTAMP | |

All tables use RLS: `auth.uid() = user_id`. GCP services use the Supabase service role key which bypasses RLS — this is consistent with how existing Lambda functions access Supabase.

**Data retention**: Keep the last 5 adapter versions per user in GCS; prune older ones. `slm_feedback` rows older than 6 months with `used_in_training=true` can be archived/deleted. `slm_training_data` is retained indefinitely as it's needed for validation holdout sets.

## Impact Measurement (Built-in, Queryable Later)

Every feedback row includes `model_version`, `scores`, `response_time_ms`, and `token_count`. `slm_eval_snapshots` captures per-version aggregates after each GRPO cycle.

Key metrics available without additional work:
- **Gold response rate over time** — % of queries where Gemini had to correct the SLM (should decrease)
- **Per-version score comparison** — average Gemini scores by model version
- **A/B comparison** — same query distribution across versions via `model_version` on feedback rows
- **Cost efficiency** — response time + token count → compute serving cost vs Gemini API cost

## Key Technical Decisions

- **Why not OpenClaw-RL directly**: Requires 8+ GPUs always running, Ray/Megatron/SGLang infra. Our approach extracts the core GRPO + OPD algorithms without the distributed systems overhead.
- **Why Gemini-as-judge**: Better than any PRM we'd train. Already in the stack. Scores + generates corrections in one call.
- **Why per-user (not per-document)**: Simplest serving — one model load per user. BM25 handles document targeting for training signal relevance.
- **Why GCP**: Gemini is already there. Keeps training + scoring in one cloud. Frontend triggers via HTTP — no cross-cloud IAM.
- **Why separate pipeline**: De-risks the project. Existing Gemini Q&A keeps working. Switch to SLM only when results prove good.
- **Why log-prob selection at inference (not Gemini)**: Calling Gemini synchronously at query time would add latency and cost, defeating the purpose of a local SLM. Log-prob is a good-enough proxy for response quality. Gemini scores async for training only.
- **On Gemini cost**: Phase 2 calls Gemini on every query (to score K=4 responses async). This is an investment in model improvement, not serving cost. As gold_response_rate decreases over GRPO cycles, the SLM handles more queries independently. A future optimization: skip Gemini scoring for queries where all K responses have high self-consistency (agreement = likely correct).
