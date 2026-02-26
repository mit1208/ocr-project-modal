# AWS Infrastructure for OCR ETL

This folder contains the Terraform configuration for the serverless OCR pipeline using AWS Lambda and Step Functions.

## Architecture
1. **Amazon S3 Bucket**: Stores uploaded PDFs.
2. **Step Functions (OcrPdfPipeline)**: Orchestrates the entire ETL process:
    - `pdf_split`: Chunks large PDFs into individual pages.
    - `invoke_modal`: (Map State) Calls the Modal OCR API for each page in parallel.
    - `analyze_document`: Uses Gemini-2.5-Flash to analyze the combined OCR text.
    - `compute_embeddings`: Generates 768-dim vectors for RAG.
3. **Lambda Layers**:
    - `ocr_shared_dependencies`: Gemini SDK, Supabase.
    - `ocr_vendor_dependencies`: PyMuPDF (fitz), PyPDF.

## Prerequisites
1. Terraform binary (included in this folder as `./terraform`).
2. AWS CLI configured (`aws configure`).
3. `terraform.tfvars` file containing your API keys and Supabase credentials.

## Deployment

A `Makefile` is provided for quick commands:

- **Initialize**: `make init`
- **One-Command Deploy**: `make deploy` (Runs apply with auto-approve)
- **Review Changes**: `make plan`
- **Cleanup**: `make clean`

## Manual Deployment

1. **Initialize:** `./terraform init`
2. **Apply:** `./terraform apply -var-file=terraform.tfvars`
