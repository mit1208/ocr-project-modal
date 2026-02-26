# Makefile for managing OCR Infrastructure

TF_BIN := ./terraform
TF_VARS := terraform.tfvars

.PHONY: init plan deploy destroy clean

# Initialize Terraform
init:
	$(TF_BIN) init

# Show the deployment plan
plan:
	$(TF_BIN) plan -var-file=$(TF_VARS)

# Deploy the infrastructure (One Command)
deploy:
	$(TF_BIN) apply -auto-approve -var-file=$(TF_VARS)

# Destroy the infrastructure
destroy:
	$(TF_BIN) destroy -var-file=$(TF_VARS)

# Clean up local ZIP files from deployment
clean:
	rm -f *.zip

# Full reset (use only if you want to re-init everything)
reset:
	rm -f *.zip
	rm -rf .terraform/
	rm -f .terraform.lock.hcl
	rm -f terraform.tfstate*
