terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  default = "us-east-1"
}

variable "bucket_name" {
  description = "Name of the S3 bucket for OCR uploads"
  default     = "ocr-pipeline-uploads-bucket"
}

variable "modal_api_url" {
  description = "Modal FastApi Endpoint URL for OCR"
  default     = ""
}

variable "ocr_key" {
  description = "Modal API Key for OCR"
  type        = string
  default     = ""
}

variable "supabase_url" {
  description = "Supabase API URL"
  type        = string
  default     = ""
}

variable "supabase_service_role_key" {
  description = "Supabase Service Role Key"
  type        = string
  default     = ""
}

variable "gemini_api_key" {
  description = "Gemini API Key for medical analysis"
  type        = string
  default     = ""
}

# 1. S3 Bucket
resource "aws_s3_bucket" "ocr_bucket" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_cors_configuration" "cors" {
  bucket = aws_s3_bucket.ocr_bucket.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST"]
    allowed_origins = [
      "http://localhost:3000",
      "https://medical-document-chat.vercel.app"
    ]
    expose_headers  = []
    max_age_seconds = 3000
  }
}

resource "aws_s3_bucket_notification" "bucket_notification" {
  bucket      = aws_s3_bucket.ocr_bucket.id
  eventbridge = true
}

# 2. Package Lambda Functions
data "archive_file" "pdf_split_zip" {
  type        = "zip"
  source_dir  = "${path.module}/pdf_split"
  output_path = "${path.module}/pdf_split.zip"
}

data "archive_file" "invoke_ocr_zip" {
  type        = "zip"
  source_dir  = "${path.module}/invoke_ocr"
  output_path = "${path.module}/invoke_ocr.zip"
}

data "archive_file" "analyze_document_zip" {
  type        = "zip"
  source_dir  = "${path.module}/analyze_document"
  output_path = "${path.module}/analyze_document.zip"
}

data "archive_file" "compute_embeddings_zip" {
  type        = "zip"
  source_dir  = "${path.module}/compute_embeddings"
  output_path = "${path.module}/compute_embeddings.zip"
}

data "archive_file" "shared_layer_zip" {
  type        = "zip"
  source_dir  = "${path.module}/layers/shared"
  output_path = "${path.module}/shared_layer.zip"
}

resource "aws_lambda_layer_version" "shared_layer" {
  filename            = data.archive_file.shared_layer_zip.output_path
  layer_name          = "ocr_shared_dependencies"
  source_code_hash    = data.archive_file.shared_layer_zip.output_base64sha256
  compatible_runtimes = ["python3.11"]
}

data "archive_file" "ocr_vendor_layer_zip" {
  type        = "zip"
  source_dir  = "${path.module}/layers/ocr_vendor"
  output_path = "${path.module}/ocr_vendor_layer.zip"
}

resource "aws_lambda_layer_version" "ocr_vendor_layer" {
  filename            = data.archive_file.ocr_vendor_layer_zip.output_path
  layer_name          = "ocr_vendor_dependencies"
  source_code_hash    = data.archive_file.ocr_vendor_layer_zip.output_base64sha256
  compatible_runtimes = ["python3.11"]
}

# 3. IAM Role for Lambdas
data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_execution_role" {
  name               = "ocr_lambda_execution_role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "lambda_s3_access" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.ocr_bucket.arn}/*"]
  }
}

resource "aws_iam_role_policy" "lambda_s3_policy" {
  name   = "lambda_s3_access_policy"
  role   = aws_iam_role.lambda_execution_role.id
  policy = data.aws_iam_policy_document.lambda_s3_access.json
}

# 4. Lambda Functions
resource "aws_lambda_function" "pdf_split" {
  filename         = data.archive_file.pdf_split_zip.output_path
  function_name    = "ocr_pdf_split"
  role             = aws_iam_role.lambda_execution_role.arn
  handler          = "lambda_function.lambda_handler"
  source_code_hash = data.archive_file.pdf_split_zip.output_base64sha256
  runtime          = "python3.11"
  memory_size      = 512
  timeout          = 30
  layers           = [aws_lambda_layer_version.ocr_vendor_layer.arn]
  environment {
    variables = {
      MODAL_API_URL             = var.modal_api_url
      SUPABASE_URL              = var.supabase_url
      SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    }
  }
}

resource "aws_lambda_function" "invoke_ocr" {
  filename         = data.archive_file.invoke_ocr_zip.output_path
  function_name    = "ocr_invoke_ocr"
  role             = aws_iam_role.lambda_execution_role.arn
  handler          = "lambda_function.lambda_handler"
  source_code_hash = data.archive_file.invoke_ocr_zip.output_base64sha256
  runtime          = "python3.11"
  memory_size      = 2048
  timeout          = 900 # 15 minutes max
  layers           = [aws_lambda_layer_version.ocr_vendor_layer.arn]
  environment {
    variables = {
      MODAL_API_URL             = var.modal_api_url
      OCR_API_KEY               = var.ocr_key
      SUPABASE_URL              = var.supabase_url
      SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    }
  }
}

resource "aws_lambda_function" "analyze_document" {
  filename         = data.archive_file.analyze_document_zip.output_path
  function_name    = "ocr_analyze_document"
  role             = aws_iam_role.lambda_execution_role.arn
  handler          = "lambda_function.lambda_handler"
  source_code_hash = data.archive_file.analyze_document_zip.output_base64sha256
  runtime          = "python3.11"
  memory_size      = 1024
  timeout          = 300
  layers           = [aws_lambda_layer_version.shared_layer.arn]
  environment {
    variables = {
      SUPABASE_URL              = var.supabase_url
      SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
      GEMINI_API_KEY            = var.gemini_api_key
    }
  }
}

resource "aws_lambda_function" "compute_embeddings" {
  filename         = data.archive_file.compute_embeddings_zip.output_path
  function_name    = "ocr_compute_embeddings"
  role             = aws_iam_role.lambda_execution_role.arn
  handler          = "lambda_function.lambda_handler"
  source_code_hash = data.archive_file.compute_embeddings_zip.output_base64sha256
  runtime          = "python3.11"
  memory_size      = 2048 # Embeddings can be memory intensive
  timeout          = 900
  layers           = [aws_lambda_layer_version.shared_layer.arn]
  environment {
    variables = {
      SUPABASE_URL              = var.supabase_url
      SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
      GEMINI_API_KEY            = var.gemini_api_key
    }
  }
}

# 5. Step Functions
data "aws_iam_policy_document" "sfn_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "sfn_role" {
  name               = "ocr_sfn_execution_role"
  assume_role_policy = data.aws_iam_policy_document.sfn_assume_role.json
}

data "aws_iam_policy_document" "sfn_policy" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [
      aws_lambda_function.pdf_split.arn,
      aws_lambda_function.invoke_ocr.arn,
      aws_lambda_function.analyze_document.arn,
      aws_lambda_function.compute_embeddings.arn
    ]
  }
}

resource "aws_iam_role_policy" "sfn_execution_policy" {
  name   = "sfn_lambda_invoke"
  role   = aws_iam_role.sfn_role.id
  policy = data.aws_iam_policy_document.sfn_policy.json
}

resource "aws_sfn_state_machine" "ocr_pipeline" {
  name     = "OcrPdfPipeline"
  role_arn = aws_iam_role.sfn_role.arn

  definition = jsonencode({
    Comment = "Pipeline for OCR over PDF chunks"
    StartAt = "CountPages"
    States = {
      CountPages = {
        Type     = "Task"
        Resource = aws_lambda_function.pdf_split.arn
        Retry = [
          {
            ErrorEquals     = ["Lambda.ServiceException", "Lambda.AWSLambdaException", "Lambda.SdkClientException"]
            IntervalSeconds = 2
            MaxAttempts     = 6
            BackoffRate     = 2
          }
        ]
        Next           = "CheckDeduplication"
        ResultPath     = "$.pageSplitResult"
      }
      CheckDeduplication = {
        Type = "Choice"
        Choices = [
          {
            Variable      = "$.pageSplitResult.already_processed"
            BooleanEquals = true
            Next          = "SuccessExit"
          }
        ]
        Default = "ProcessChunks"
      }
      SuccessExit = {
        Type = "Succeed"
      }
      ProcessChunks = {
        Type           = "Map"
        InputPath      = "$"
        ItemsPath      = "$.pageSplitResult.chunks"
        MaxConcurrency = 2  # Each Lambda handles a batch of up to 4 pages; 2 concurrent Lambdas = 8 pages/req
        ItemProcessor = {
          ProcessorConfig = {
            Mode = "INLINE"
          }
          StartAt = "CallModal"
          States = {
            CallModal = {
              Type     = "Task"
              Resource = aws_lambda_function.invoke_ocr.arn
              Catch = [
                {
                  ErrorEquals = ["States.ALL"]
                  Next        = "PageFailed"
                }
              ]
              End = true
            }
            PageFailed = {
              Type  = "Fail"
              Error = "PageOcrFailed"
              Cause = "invoke_ocr Lambda failed after all retries"
            }
          }
        }
        ResultPath = "$.mapResults"
        Next       = "AnalyzeDocument"
      }
      AnalyzeDocument = {
        Type     = "Task"
        Resource = aws_lambda_function.analyze_document.arn
        Retry = [
          {
            ErrorEquals     = ["States.ALL"]
            IntervalSeconds = 5
            MaxAttempts     = 3
            BackoffRate     = 2.0
          }
        ]
        ResultPath = "$.analysisResult"
        Next = "ComputeEmbeddings"
      }
      ComputeEmbeddings = {
        Type     = "Task"
        Resource = aws_lambda_function.compute_embeddings.arn
        Retry = [
          {
            ErrorEquals     = ["States.ALL"]
            IntervalSeconds = 5
            MaxAttempts     = 3
            BackoffRate     = 2.0
          }
        ]
        End = true
      }
    }
  })
}

# 6. EventBridge to trigger Step Function
resource "aws_cloudwatch_event_rule" "s3_upload_rule" {
  name        = "ocr_s3_upload_rule"
  description = "Trigger Step Function on S3 upload"
  event_pattern = jsonencode({
    source      = ["aws.s3"]
    detail-type = ["Object Created"]
    detail = {
      bucket = {
        name = [var.bucket_name]
      }
      object = {
        key = [{prefix = "uploads/"}]
      }
    }
  })
}

data "aws_iam_policy_document" "events_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "events_role" {
  name               = "ocr_events_sfn_role"
  assume_role_policy = data.aws_iam_policy_document.events_assume_role.json
}

data "aws_iam_policy_document" "events_policy" {
  statement {
    actions   = ["states:StartExecution"]
    resources = [aws_sfn_state_machine.ocr_pipeline.arn]
  }
}

resource "aws_iam_role_policy" "events_sfn_policy" {
  name   = "events_sfn_policy"
  role   = aws_iam_role.events_role.id
  policy = data.aws_iam_policy_document.events_policy.json
}

resource "aws_cloudwatch_event_target" "sfn_target" {
  rule      = aws_cloudwatch_event_rule.s3_upload_rule.name
  target_id = "TriggerOcrPipeline"
  arn       = aws_sfn_state_machine.ocr_pipeline.arn
  role_arn  = aws_iam_role.events_role.arn
}

# 7. Body Map API (API Gateway + Lambda)
data "archive_file" "body_map_zip" {
  type        = "zip"
  source_dir  = "${path.module}/body_map"
  output_path = "${path.module}/body_map.zip"
}

resource "aws_lambda_function" "body_map" {
  filename         = data.archive_file.body_map_zip.output_path
  function_name    = "ocr_body_map"
  role             = aws_iam_role.lambda_execution_role.arn
  handler          = "lambda_function.lambda_handler"
  source_code_hash = data.archive_file.body_map_zip.output_base64sha256
  runtime          = "python3.11"
  memory_size      = 512
  timeout          = 60
  layers           = [aws_lambda_layer_version.shared_layer.arn]
  environment {
    variables = {
      SUPABASE_URL              = var.supabase_url
      SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
      GEMINI_API_KEY            = var.gemini_api_key
    }
  }
}

resource "aws_apigatewayv2_api" "body_map_api" {
  name          = "ocr-body-map-api"
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = ["http://localhost:3000", "https://medical-document-chat.vercel.app"]
    allow_methods = ["GET", "OPTIONS"]
    allow_headers = ["Content-Type"]
    max_age       = 300
  }
}

resource "aws_apigatewayv2_integration" "body_map" {
  api_id           = aws_apigatewayv2_api.body_map_api.id
  integration_type = "AWS_PROXY"
  
  integration_method = "POST"
  integration_uri    = aws_lambda_function.body_map.invoke_arn
}

resource "aws_apigatewayv2_route" "body_map" {
  api_id    = aws_apigatewayv2_api.body_map_api.id
  route_key = "GET /body-map/{file_id}"
  target    = "integrations/${aws_apigatewayv2_integration.body_map.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.body_map_api.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "api_gw" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.body_map.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.body_map_api.execution_arn}/*/*"
}

output "body_map_api_url" {
  value = aws_apigatewayv2_stage.default.invoke_url
}
