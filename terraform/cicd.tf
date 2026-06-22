# =====================================================================
# CI/CD — AWS CodePipeline + CodeBuild (gated by var.enable_cicd).
#
#   GitHub push ─► CodePipeline (Source) ─► CodeBuild (build+push+deploy)
#
# CodeBuild runs buildspec.yml: builds the 3 images on native x86, pushes to
# ECR, and force-redeploys ECS (and optionally EKS). This replaces the old
# Jenkins pipeline with an all-AWS, serverless one. See docs/CICD-CODEPIPELINE.md.
#
# NOTE: the GitHub connection is created in PENDING state — you must authorize it
# once in the console (Developer Tools → Connections) before the pipeline can run.
# =====================================================================

locals {
  cicd_count = var.enable_cicd ? 1 : 0
}

# ---- GitHub source connection (CodeStar Connections) ----
resource "aws_codestarconnections_connection" "github" {
  count         = local.cicd_count
  name          = "${var.project}-github"
  provider_type = "GitHub"
}

# ---- Artifact bucket (CodePipeline hands the source to CodeBuild through this) ----
resource "aws_s3_bucket" "cicd" {
  count         = local.cicd_count
  bucket        = "${var.project}-cicd-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

data "aws_caller_identity" "current" {}

# ---- CodeBuild role: build images, push to ECR, redeploy ECS/EKS ----
resource "aws_iam_role" "codebuild" {
  count = local.cicd_count
  name  = "${var.project}-codebuild"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "codebuild.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "codebuild" {
  count = local.cicd_count
  name  = "${var.project}-codebuild"
  role  = aws_iam_role.codebuild[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "*"
      },
      {
        Sid      = "EcrAuth"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "EcrPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:CompleteLayerUpload",
          "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart",
          "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"
        ]
        Resource = [for r in aws_ecr_repository.this : r.arn]
      },
      {
        Sid      = "DeployEcs"
        Effect   = "Allow"
        Action   = ["ecs:UpdateService", "ecs:DescribeServices"]
        Resource = "*"
      },
      {
        Sid      = "DeployEksDescribe"
        Effect   = "Allow"
        Action   = ["eks:DescribeCluster"]
        Resource = "*"
      },
      {
        Sid      = "Artifacts"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:GetBucketAcl", "s3:GetBucketLocation"]
        Resource = ["${aws_s3_bucket.cicd[0].arn}", "${aws_s3_bucket.cicd[0].arn}/*"]
      },
      {
        Sid      = "WhoAmI"
        Effect   = "Allow"
        Action   = ["sts:GetCallerIdentity"]
        Resource = "*"
      }
    ]
  })
}

# ---- CodeBuild project ----
resource "aws_codebuild_project" "shopnow" {
  count        = local.cicd_count
  name         = "${var.project}-build"
  service_role = aws_iam_role.codebuild[0].arn

  artifacts { type = "CODEPIPELINE" }

  environment {
    compute_type    = "BUILD_GENERAL1_MEDIUM"
    image           = "aws/codebuild/standard:7.0"
    type            = "LINUX_CONTAINER"
    privileged_mode = true # required to run docker builds
  }

  source {
    type      = "CODEPIPELINE"
    buildspec = "buildspec.yml"
  }

  logs_config {
    cloudwatch_logs { group_name = "/codebuild/${var.project}" }
  }
}

# ---- CodePipeline role ----
resource "aws_iam_role" "codepipeline" {
  count = local.cicd_count
  name  = "${var.project}-codepipeline"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "codepipeline.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "codepipeline" {
  count = local.cicd_count
  name  = "${var.project}-codepipeline"
  role  = aws_iam_role.codepipeline[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Artifacts"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:GetBucketAcl", "s3:GetBucketLocation"]
        Resource = ["${aws_s3_bucket.cicd[0].arn}", "${aws_s3_bucket.cicd[0].arn}/*"]
      },
      {
        Sid      = "RunBuild"
        Effect   = "Allow"
        Action   = ["codebuild:BatchGetBuilds", "codebuild:StartBuild"]
        Resource = aws_codebuild_project.shopnow[0].arn
      },
      {
        Sid      = "UseConnection"
        Effect   = "Allow"
        Action   = ["codestar-connections:UseConnection"]
        Resource = aws_codestarconnections_connection.github[0].arn
      }
    ]
  })
}

# ---- Pipeline: Source (GitHub) -> Build (CodeBuild) ----
resource "aws_codepipeline" "shopnow" {
  count    = local.cicd_count
  name     = "${var.project}-pipeline"
  role_arn = aws_iam_role.codepipeline[0].arn

  artifact_store {
    type     = "S3"
    location = aws_s3_bucket.cicd[0].bucket
  }

  stage {
    name = "Source"
    action {
      name             = "GitHub"
      category         = "Source"
      owner            = "AWS"
      provider         = "CodeStarSourceConnection"
      version          = "1"
      output_artifacts = ["source"]
      configuration = {
        ConnectionArn    = aws_codestarconnections_connection.github[0].arn
        FullRepositoryId = "${var.github_owner}/${var.github_repo}"
        BranchName       = var.github_branch
      }
    }
  }

  stage {
    name = "Build"
    action {
      name             = "BuildAndDeploy"
      category         = "Build"
      owner            = "AWS"
      provider         = "CodeBuild"
      version          = "1"
      input_artifacts  = ["source"]
      output_artifacts = []
      configuration = {
        ProjectName = aws_codebuild_project.shopnow[0].name
      }
    }
  }
}
