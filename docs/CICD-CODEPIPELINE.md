# CI/CD with AWS CodePipeline + CodeBuild

All-AWS, serverless CI/CD. On every push to the repo it **builds the 3 images →
pushes to ECR → redeploys ECS** (and optionally EKS) — no Jenkins server to run.

```
 git push ─► CodePipeline ─► Source (GitHub) ─► CodeBuild (buildspec.yml)
                                                  ├─ build frontend / products / cart
                                                  ├─ push :<sha> and :latest to ECR
                                                  └─ aws ecs update-service --force-new-deployment
```

- Pipeline + build project are defined in Terraform: [`terraform/cicd.tf`](../terraform/cicd.tf)
- Build steps live in [`buildspec.yml`](../buildspec.yml) at the repo root.

> **Why we use it:** CodeBuild runs on **native x86**, so images build without
> emulation and push to ECR **in-region** — which sidesteps the Docker-Desktop
> push stalls you hit building locally on Apple Silicon. It's also the same tool
> that built the images the first time.

---

## What each piece is

| Resource (Terraform) | Role |
|----------------------|------|
| `aws_codestarconnections_connection.github` | OAuth link to GitHub (the pipeline's source) |
| `aws_codebuild_project.shopnow` | Runs `buildspec.yml` in a privileged x86 container (Docker enabled) |
| `aws_codepipeline.shopnow` | Source → Build orchestration, triggered on push |
| `aws_s3_bucket.cicd` | Artifact store (hands the source to CodeBuild) |
| IAM roles | CodeBuild: ECR push + ECS/EKS deploy. CodePipeline: run build + use connection |

The build tags every image with both the **short commit SHA** (immutable, traceable)
and `latest`. ECS task definitions reference `:latest`, so a forced new deployment
re-pulls the fresh image (rolling, zero-downtime).

---

## One-time setup

### 1. Prerequisite — the infrastructure must already exist
The pipeline **deploys** to the ECS/EKS clusters; it doesn't create them. Stand the
infra up first (see the main [README](../README.md)):
```bash
cd terraform && terraform apply
```

### 2. Create the pipeline
It's off by default (so the core infra applies without a GitHub link). Turn it on:
```bash
cd terraform
terraform apply -var enable_cicd=true \
  -var github_owner=Benjamin-yankey \
  -var github_repo=Poly-Orchestrator \
  -var github_branch=main
```

### 3. Authorize the GitHub connection (the one manual step)
Terraform creates the connection in **PENDING** state — AWS requires a human to
complete the GitHub OAuth handshake. Do it once:

1. Get the connection ARN:
   ```bash
   terraform output -raw cicd_connection_arn
   ```
2. AWS Console → **Developer Tools → Settings → Connections** → click
   `shopnow-github` → **Update pending connection** → authorize the AWS Connector
   for GitHub and pick the repo. Status flips **PENDING → AVAILABLE**.

Until this is AVAILABLE the pipeline's Source stage will fail — this is expected.

### 4. (Optional) Let the pipeline deploy to EKS too
By default the build redeploys **ECS only** (`DEPLOY_EKS: "false"` in
`buildspec.yml`). To also roll the EKS Deployments:

1. Set `DEPLOY_EKS: "true"` in [`buildspec.yml`](../buildspec.yml).
2. Grant the CodeBuild role access **inside** the cluster (IAM only gets it to the
   door; Kubernetes RBAC controls the rest):
   ```bash
   ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
   ROLE_ARN=arn:aws:iam::$ACCOUNT:role/shopnow-codebuild
   aws eks create-access-entry --cluster-name shopnow-eks --region us-east-1 \
     --principal-arn "$ROLE_ARN"
   aws eks associate-access-policy --cluster-name shopnow-eks --region us-east-1 \
     --principal-arn "$ROLE_ARN" \
     --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy \
     --access-scope type=cluster
   ```
   (Tighten to a namespace-scoped policy for least privilege later.)

---

## How to run it

### Automatically — on every push
Once the connection is AVAILABLE, **any push to `main`** triggers the pipeline.
Nothing else to do: push code, watch the run.

### Manually — release the latest commit now
```bash
aws codepipeline start-pipeline-execution --name shopnow-pipeline --region us-east-1
```

### Watch a run
- **Console:** CodePipeline → `shopnow-pipeline` (live stage view, click into the
  Build action for streaming logs).
- **CLI:**
  ```bash
  # latest execution status
  aws codepipeline list-pipeline-executions --pipeline-name shopnow-pipeline \
    --region us-east-1 --max-items 1 \
    --query 'pipelineExecutionSummaries[0].{id:pipelineExecutionId,status:status}'

  # tail the build logs
  aws logs tail /codebuild/shopnow --follow --region us-east-1
  ```

### Confirm the deploy landed
```bash
aws ecs describe-services --cluster shopnow-ecs --services frontend products cart \
  --region us-east-1 --query 'services[].{s:serviceName,r:runningCount,d:desiredCount}' --output table
```

---

## Heads-up: remove the temporary build resources first

The very first images were shipped with a **throwaway** CodeBuild project (S3
source) created by hand during setup — it reuses the same names this Terraform
uses (`shopnow-build`, `shopnow-codebuild`), so `terraform apply -var enable_cicd=true`
will fail with "already exists" until you delete them:

```bash
aws codebuild delete-project --name shopnow-build --region us-east-1 2>/dev/null || true
aws iam detach-role-policy --role-name shopnow-codebuild \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess 2>/dev/null || true
aws iam delete-role --role-name shopnow-codebuild 2>/dev/null || true
aws s3 rb s3://shopnow-codebuild-src-$(aws sts get-caller-identity --query Account --output text) --force 2>/dev/null || true
```

Then `terraform apply -var enable_cicd=true` creates the proper, pipeline-driven
versions. (The Terraform CodeBuild project has a `CODEPIPELINE` source, so it runs
via the pipeline — use `start-pipeline-execution` above to trigger a build, not
`start-build`.)

---

## Migrating from Jenkins

This replaces the old Jenkins pipeline. The mapping is 1:1:

| Jenkins | CodePipeline + CodeBuild |
|---------|--------------------------|
| Jenkins server + agents | None — fully managed/serverless |
| `Jenkinsfile` | [`buildspec.yml`](../buildspec.yml) + [`terraform/cicd.tf`](../terraform/cicd.tf) |
| Credentials store (AWS keys) | CodeBuild **IAM role** (no stored keys) |
| GitHub webhook | CodeStar **connection** (managed trigger) |
| Blue Ocean stage view | CodePipeline console / CloudWatch logs |
| `aws-access-key-id` / `aws-secret-access-key` | gone — role-based auth |

Net win: no server to patch, no long-lived keys, and it's all in Terraform.

---

## Teardown

```bash
cd terraform && terraform destroy -var enable_cicd=true   # removes pipeline + build + roles + bucket
```
(The GitHub connection is deleted too; re-authorizing is required if you recreate it.)
