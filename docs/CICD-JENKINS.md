# CI/CD with Jenkins — auto-deploy ShopNow to ECS & EKS

This pipeline replaces the manual `docker build / push / redeploy` loop. On every
commit it: **builds the 3 images → pushes to ECR → redeploys ECS and EKS.**

```
 git push ─► Jenkins ─► build images ─► push to ECR ─► force-new-deployment (ECS)
                                                   └─► kubectl set image    (EKS)
```

The pipeline definition is [`/Jenkinsfile`](../Jenkinsfile).

---

## How it authenticates (no AWS keys stored)

### Running Jenkins LOCALLY (this setup)

A laptop Jenkins has no AWS compute under it, so it **cannot** use an IAM
instance role. Instead, store AWS keys in the **Jenkins credentials store** and
let the pipeline inject them. The `Jenkinsfile` already does this:

```groovy
AWS_ACCESS_KEY_ID     = credentials('aws-access-key-id')
AWS_SECRET_ACCESS_KEY = credentials('aws-secret-access-key')
```

Create two **Secret text** credentials (Manage Jenkins → Credentials → System →
Global) with exactly these IDs:

| Credential ID            | Value                       |
|--------------------------|-----------------------------|
| `aws-access-key-id`      | your `AWS_ACCESS_KEY_ID`     |
| `aws-secret-access-key`  | your `AWS_SECRET_ACCESS_KEY` |

The AWS CLI reads those env-var names automatically — every `aws` call in the
pipeline is then authenticated. Use an IAM **user** whose permissions match
[`ci/jenkins-iam-policy.json`](../ci/jenkins-iam-policy.json).

> **If you later move Jenkins onto AWS** (EC2/ECS/EKS), drop the keys and switch
> to an **instance profile / task role / IRSA** — then delete those two
> credentials and the two `credentials(...)` lines. That's the no-stored-secrets
> setup. On a laptop, the credentials store is the correct approach.

---

## One-time setup

### 1. Prerequisites — tools the pipeline needs
Wherever the build runs, these must be on `PATH`: **docker**, **aws** (CLI v2),
**kubectl**, **git**. How you get them depends on how you run Jenkins locally:

| Local Jenkins        | What to check |
|----------------------|---------------|
| **Native** (`brew install jenkins-lts` / `java -jar jenkins.war`) | Docker Desktop running; `aws`/`kubectl`/`git` installed. The `jenkins` daemon user may have a *different PATH* than your shell — if a tool "isn't found," run Jenkins as your user or add the tool paths in Jenkins → Global Tool / node env. |
| **Docker container** (`jenkins/jenkins`) | The image has none of these. Mount the Docker socket (`-v /var/run/docker.sock:/var/run/docker.sock`) and install `aws`/`kubectl` in the container (or use an agent image that bundles them). |

Jenkins plugins: **Pipeline**, **Git**, **Credentials Binding** (for the
`credentials()` helper), **Blue Ocean** (visual pipeline view — see below), and
optionally **Docker Pipeline**.

### Blue Ocean — watch the parallel run

The pipeline fans out: the 3 images **build + push in parallel**, then **ECS and
EKS deploy in parallel**. Blue Ocean draws each of those as its own lane so you
can watch them run side by side.

1. Install the **Blue Ocean** plugin: *Manage Jenkins → Plugins → Available* →
   search `Blue Ocean` → install (it pulls in the pipeline-visualization deps).
2. Open it from the left sidebar **Open Blue Ocean**, or go straight to
   `http://<jenkins-host>/blue`.
3. Pick the job and a run. You'll see the stage graph:

```
Resolve ─► Login to ECR ─► Build & push ─┬─ build frontend ┐   Deploy ─┬─ Deploy to ECS
                                         ├─ build products ┤          └─ Deploy to EKS
                                         └─ build cart     ┘
```

Click any lane to stream just that branch's logs. Parallel branches need no extra
config — Blue Ocean renders any `parallel {}` / `parallel(...)` block as lanes
automatically.

> Concurrency note: all branches run on the same `agent any`, so 3 `docker build`
> jobs share that node's CPU/RAM. On a constrained laptop that's still faster than
> serial (the pushes overlap), but if builds thrash, give the node more resources
> or run builds on separate agents.

> On Apple Silicon the pipeline builds `--platform linux/amd64` (matches Fargate /
> EKS nodes). Docker Desktop's buildx + QEMU handle the emulation automatically.

### 2. Give the IAM user the deploy permissions
The keys you stored belong to an IAM **user**. Attach
[`ci/jenkins-iam-policy.json`](../ci/jenkins-iam-policy.json) (ECR push + ECS
deploy + EKS describe) to that user:

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

aws iam create-policy \
  --policy-name ShopNowJenkinsDeploy \
  --policy-document file://ci/jenkins-iam-policy.json

aws iam attach-user-policy \
  --user-name <jenkins-iam-user> \
  --policy-arn arn:aws:iam::$ACCOUNT:policy/ShopNowJenkinsDeploy
```

### 3. Grant that IAM user access INSIDE the EKS cluster
IAM only gets you to the cluster door; Kubernetes RBAC controls what you can do
once inside. Add an EKS **access entry** for the IAM user:

```bash
REGION=us-east-1
JENKINS_USER_ARN=arn:aws:iam::$ACCOUNT:user/<jenkins-iam-user>

aws eks create-access-entry \
  --cluster-name shopnow-eks --region $REGION \
  --principal-arn "$JENKINS_USER_ARN"

aws eks associate-access-policy \
  --cluster-name shopnow-eks --region $REGION \
  --principal-arn "$JENKINS_USER_ARN" \
  --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy \
  --access-scope type=cluster
```

> Tighten `AmazonEKSClusterAdminPolicy` to a namespace-scoped policy later if you
> want least privilege.

### 4. Create the Jenkins pipeline job
1. **New Item → Pipeline** (or **Multibranch Pipeline** to auto-build branches).
2. **Pipeline → Definition:** *Pipeline script from SCM*.
3. Point it at your Git repo; **Script Path:** `Jenkinsfile`.
4. Save. The job exposes parameters: `AWS_REGION`, `PROJECT`, `DEPLOY_ECS`,
   `DEPLOY_EKS`.

### 5. Trigger on push (so it's automatic)
- **GitHub/GitLab:** add a webhook to your Jenkins URL (`/github-webhook/`), or
- enable **Poll SCM** / **scan** on the job.

---

## What each stage does

| Stage | Action |
|-------|--------|
| Resolve account & tag | Looks up the AWS account; sets image tag = short git SHA |
| Login to ECR          | `docker login` to your private registry |
| Build & push images   | Builds `frontend`, `products`, `cart` for `linux/amd64`; pushes `:<sha>` and `:latest` |
| Deploy to ECS         | `aws ecs update-service --force-new-deployment` for each service (re-pulls latest) |
| Deploy to EKS         | `kubectl set image` to the `:<sha>` tag, then waits for rollout |

Both deploy stages are gated by `DEPLOY_ECS` / `DEPLOY_EKS` params, so you can run
build-only, or target a single orchestrator.

---

## Prerequisite: infrastructure must already exist

The pipeline **deploys** to clusters; it does not create them. Run the Terraform
once first (see the main [README](../README.md)):

```bash
cd terraform && terraform apply
```

After that, every `git push` ships your changes to both clusters automatically.

---

## First run order

1. `terraform apply` — creates VPC, ECR, ECS & EKS (one time)
2. Push code → Jenkins builds images, pushes to ECR, deploys to ECS + EKS
3. (EKS only, one time) install the AWS Load Balancer Controller for the public
   Ingress — see README "EKS deployment" step 3
