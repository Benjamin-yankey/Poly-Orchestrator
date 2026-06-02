variable "region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Name prefix for all resources"
  type        = string
  default     = "shopnow"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

# Toggle the two orchestrators independently so you can benchmark / cost-control
# one at a time:  terraform apply -var enable_eks=false   (ECS only)
variable "enable_ecs" {
  description = "Create the ECS (Fargate) stack"
  type        = bool
  default     = true
}

variable "enable_eks" {
  description = "Create the EKS stack"
  type        = bool
  default     = true
}

variable "db_password" {
  description = "Postgres password (demo only — use Secrets Manager in production)"
  type        = string
  default     = "shopnow_pass"
  sensitive   = true
}
