#!/bin/bash
# Script to restore terraform state after accidental deletion

TF_BIN="./terraform"

echo "Attempting to import existing resources back into state..."

# 1. S3 Bucket
$TF_BIN import -var-file=terraform.tfvars aws_s3_bucket.ocr_bucket my-databricks-ocr-uploads

# 2. IAM Roles
$TF_BIN import -var-file=terraform.tfvars aws_iam_role.lambda_execution_role ocr_lambda_execution_role
$TF_BIN import -var-file=terraform.tfvars aws_iam_role.sfn_role ocr_sfn_execution_role
$TF_BIN import -var-file=terraform.tfvars aws_iam_role.events_role ocr_events_sfn_role

# 3. CloudWatch Rule
$TF_BIN import -var-file=terraform.tfvars aws_cloudwatch_event_rule.s3_upload_rule ocr_s3_upload_rule

# 4. Lambda Functions (may need importing if they already exist)
$TF_BIN import -var-file=terraform.tfvars aws_lambda_function.pdf_split ocr_pdf_split
$TF_BIN import -var-file=terraform.tfvars aws_lambda_function.invoke_modal ocr_invoke_modal
$TF_BIN import -var-file=terraform.tfvars aws_lambda_function.analyze_document ocr_analyze_document
$TF_BIN import -var-file=terraform.tfvars aws_lambda_function.compute_embeddings ocr_compute_embeddings

# 5. Step Function
$TF_BIN import -var-file=terraform.tfvars aws_sfn_state_machine.ocr_pipeline arn:aws:states:us-east-1:374062007049:stateMachine:OcrPdfPipeline

echo "Import complete. Re-run 'make deploy' to sync remaining resources (policies, layers, etc)."
