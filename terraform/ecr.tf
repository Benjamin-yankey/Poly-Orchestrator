# One ECR repo per microservice image. The SAME images feed ECS and EKS.
locals {
  ecr_repos = ["frontend", "products", "cart"]
}

resource "aws_ecr_repository" "this" {
  for_each             = toset(local.ecr_repos)
  name                 = "${var.project}/${each.key}"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
}
