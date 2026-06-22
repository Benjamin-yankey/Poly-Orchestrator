# ---- Shared ----
output "region" {
  value = var.region
}

output "ecr_repos" {
  description = "Push each microservice image to its repo"
  value       = { for k, r in aws_ecr_repository.this : k => r.repository_url }
}

# ---- ECS ----
output "ecs_cluster_name" {
  value = var.enable_ecs ? aws_ecs_cluster.this[0].name : null
}

output "ecs_frontend_url" {
  description = "Open this in a browser once ECS services are healthy"
  value       = var.enable_ecs ? "http://${aws_lb.frontend[0].dns_name}" : null
}

# ---- EKS ----
output "eks_cluster_name" {
  value = var.enable_eks ? module.eks[0].cluster_name : null
}

output "eks_kubeconfig_command" {
  description = "Run this to point kubectl at the new cluster"
  value       = var.enable_eks ? "aws eks update-kubeconfig --region ${var.region} --name ${module.eks[0].cluster_name}" : null
}

# ---- CI/CD ----
output "cicd_connection_arn" {
  description = "Authorize this GitHub connection once (console → Developer Tools → Connections) before the pipeline can run"
  value       = var.enable_cicd ? aws_codestarconnections_connection.github[0].arn : null
}

output "cicd_pipeline_name" {
  description = "CodePipeline name"
  value       = var.enable_cicd ? aws_codepipeline.shopnow[0].name : null
}
