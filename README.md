# Poly-Orchestrator — ShopNow on ECS (Fargate) vs EKS

Benchmark the **same** microservices e-commerce app deployed two ways on AWS, so
the CTO can pick an orchestrator. One codebase, one set of container images, two
runtimes.

**ShopNow is a full storefront:** browse/search a catalog, register & log in
(JWT), keep a per-user cart with quantities, check out through a **mock payment
gateway**, view order history, and manage the catalog + orders from an **admin
panel**. The UI is an **Angular SPA**; the three backend services keep the
original "database-per-service" shape so the ECS-vs-EKS comparison still holds.

| Area      | What you can do                                                        |
|-----------|------------------------------------------------------------------------|
| Storefront| Search, filter by category, product detail pages, add to cart          |
| Accounts  | Register / login, JWT-secured sessions, per-user carts & order history  |
| Checkout  | Quantities, mock payment (declines any card ending `0000`), order confirmation |
| Admin     | Dashboard stats, product CRUD, view all orders (role-gated)            |

**Demo logins** (seeded on first boot): admin `admin@shopnow.local` / `admin123`,
customer `demo@shopnow.local` / `demo123`.

```
                       ┌──────────────┐
              ┌───────►│  Products svc├──► Postgres   (own DB)
  Internet ─► Frontend │  (Node API)  │
              │        └──────────────┘
   public LB  │        ┌──────────────┐
              └───────►│   Cart svc   ├──► Redis      (own DB)
                       │  (Node API)  │
        service        └──────────────┘
        discovery
```

Three independently deployable services + **database-per-service** (Products owns
Postgres, Cart owns Redis):

| Service   | Tech                      | Owns / talks to                       | Port |
|-----------|---------------------------|---------------------------------------|------|
| Frontend  | Angular SPA + Express proxy | serves the SPA, calls Products & Cart | 8080 |
| Products  | Node.js + Express         | **Postgres** (catalog, users, orders) | 5001 |
| Cart      | Node.js + Express         | **Redis** (per-user carts + visits)   | 5002 |
| Postgres  | postgres:16-alpine        | — (owned by Products)                 | 5432 |
| Redis     | redis:7-alpine            | — (owned by Cart)                     | 6379 |

The Products service is the relational system-of-record (catalog + accounts +
orders); the Cart service keeps per-user carts in Redis. Both verify the **same
JWT** using a shared `JWT_SECRET`, so auth works regardless of which service the
request lands on. The frontend builds the Angular app at image-build time and
serves the static bundle, reverse-proxying `/api/*` to the right service.

The frontend never hard-codes addresses; it discovers each service by name via
two env vars (`PRODUCTS_URL`, `CART_URL`). Those — plus the shared `JWT_SECRET` —
are the only things that differ between environments:

| Service  | ECS (Cloud Map)                       | EKS (kube-dns)        |
|----------|---------------------------------------|-----------------------|
| Products | `http://products.shopnow.local:5001`  | `http://products:5001`|
| Cart     | `http://cart.shopnow.local:5002`      | `http://cart:5002`    |

---

## Repository layout

```
.
├── app/
│   ├── frontend/        # Express proxy + Dockerfile (multi-stage)
│   │   └── web/         #   Angular SPA (storefront + admin), built into the image
│   ├── products/        # Products/core API (Postgres: catalog, users, orders)
│   └── cart/            # Cart microservice (Redis: per-user carts) + Dockerfile
├── docker-compose.yml   # run the whole stack locally
├── buildspec.yml        # CI build steps (build → push to ECR → deploy)
├── terraform/           # VPC + ECR + ECS + EKS + CI/CD (one apply)
│   ├── vpc.tf  ecr.tf  ecs.tf  eks.tf  cicd.tf  variables.tf  outputs.tf
├── eks/                 # Kubernetes manifests (Deployments/Services/Ingress)
└── docs/
    └── CICD-CODEPIPELINE.md  # CodePipeline + CodeBuild setup guide
```

---

## Prerequisites

- AWS account + `aws` CLI configured (`aws sts get-caller-identity` works)
- `terraform >= 1.5`, `docker`, `kubectl`, and `helm`
- An IAM identity with permissions for VPC, ECS, EKS, ECR, ELB, IAM, Cloud Map

> 💸 **Cost warning:** This creates NAT gateways, ALBs, an EKS control plane
> (~$0.10/hr) and EC2 nodes. Run `terraform destroy` when done. Use the toggles
> below to stand up only one orchestrator at a time.

---

## Step 1 — Containerize & verify locally

The images are environment-agnostic; service names in compose (`postgres`,
`redis`, `backend`) act exactly like service discovery does in the cloud.

```bash
docker compose up --build
# open http://localhost:8080  (Angular storefront)
```

The Postgres catalog and the demo admin/customer accounts are seeded on first
boot. Sign in with one of the demo logins above, browse, add to cart, and check
out with any card number (e.g. `4242 4242 4242 4242`; a number ending in `0000`
is declined so you can test the failure path).

Quick API smoke test against the proxy (this is what was verified during build):

```bash
B=http://localhost:8080
curl $B/health                                   # {"status":"ok","tier":"frontend"}
curl "$B/api/products?search=mouse"              # catalog (search/filter) -> Products -> Postgres
curl "$B/api/categories"                         # distinct categories

# Auth -> capture a JWT
TOKEN=$(curl -s -X POST $B/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"demo@shopnow.local","password":"demo123"}' | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

# Per-user cart (requires the token) -> Cart -> Redis
curl -X POST $B/api/cart -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"productId":1,"name":"Wireless Mouse","price":24.99,"icon":"🖱️","qty":2}'
curl $B/api/cart -H "Authorization: Bearer $TOKEN"   # {items, count, subtotal}

# Checkout through the mock gateway -> Products -> Postgres (orders)
curl -X POST $B/api/orders -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"items":[{"productId":1,"name":"Wireless Mouse","price":24.99,"qty":2}],
       "payment":{"cardNumber":"4242 4242 4242 4242","name":"Demo","expiry":"12/29","cvc":"123"}}'
curl $B/api/orders -H "Authorization: Bearer $TOKEN"  # order history
```

`servedBy` (on catalog/cart responses) shows which instance answered — note
Products and Cart report different IDs, proving they are separate services.

Tear down: `docker compose down -v`

---

## Step 2 — Provision infrastructure (Terraform)

One `apply` builds the shared **VPC**, two **ECR** repos, the **ECS cluster +
services**, and the **EKS cluster**.

```bash
cd terraform
terraform init
terraform apply            # both orchestrators
# or, one at a time to save cost:
#   terraform apply -var enable_eks=false   # ECS only
#   terraform apply -var enable_ecs=false   # EKS only
```

Useful outputs:

```bash
terraform output ecr_repos          # map: frontend / products / cart -> repo URLs
terraform output ecs_frontend_url
terraform output eks_kubeconfig_command
```

> Note: ECS services will be created but their tasks can't start until the
> images exist in ECR. Do Step 3 next, then the services converge automatically
> (ECS keeps retrying). If you prefer, run `terraform apply` again after pushing.

---

## Step 3 — Build & push images to ECR

```bash
cd ..                       # repo root
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=$(cd terraform && terraform output -raw region)
ECR=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com

aws ecr get-login-password --region $REGION \
  | docker login --username AWS --password-stdin $ECR

# Build each microservice for the cluster CPU arch (amd64) regardless of laptop:
for svc in frontend products cart; do
  docker build --platform linux/amd64 -t $ECR/shopnow/$svc:latest ./app/$svc
  docker push $ECR/shopnow/$svc:latest
done
```

If ECS tasks were waiting, force them to pick up the images:

```bash
CLUSTER=$(cd terraform && terraform output -raw ecs_cluster_name)
for s in postgres redis products cart frontend; do
  aws ecs update-service --cluster $CLUSTER --service $s --force-new-deployment --region $REGION >/dev/null
done
```

> 🤖 **Tired of doing this on every change?** Steps 3–5 (build → push → redeploy
> ECS + EKS) are automated with **AWS CodePipeline + CodeBuild** ([`buildspec.yml`](buildspec.yml)
> + [`terraform/cicd.tf`](terraform/cicd.tf)). After a one-time setup, every
> `git push` ships your changes. See [docs/CICD-CODEPIPELINE.md](docs/CICD-CODEPIPELINE.md).
> CodeBuild also builds on native x86, which avoids local Docker push issues on
> Apple Silicon.

---

## Step 4 — ECS (Fargate) deployment

Already defined in `terraform/ecs.tf`. What it creates:

- **ECS cluster** (`shopnow-ecs`) running on Fargate (no EC2 to manage)
- **Task Definitions** for frontend, products, cart, postgres, redis
- **Services** keeping `desired_count` tasks alive (2 each for the app services)
- **Service Discovery via AWS Cloud Map** — a private DNS namespace
  `shopnow.local`; each service registers `A` records, so services are reachable
  at `products.shopnow.local`, `cart.shopnow.local`, `postgres.shopnow.local`, etc.
- **Load Balancing** — a public **Application Load Balancer** in front of the
  frontend; an internal target group health-checks `/health`.

Open the app:

```bash
terraform -chdir=terraform output -raw ecs_frontend_url   # http://<alb-dns>
```

Watch it converge:

```bash
aws ecs list-services --cluster shopnow-ecs --region $REGION
aws ecs describe-services --cluster shopnow-ecs --services frontend products cart \
  --region $REGION --query 'services[].{name:serviceName,running:runningCount,desired:desiredCount}'
```

**How service discovery is wired:** the frontend task gets
`PRODUCTS_URL=http://products.shopnow.local:5001` and
`CART_URL=http://cart.shopnow.local:5002`. The products task gets
`PG_HOST=postgres.shopnow.local`; the cart task gets `REDIS_HOST=redis.shopnow.local`.
Cloud Map resolves these names to the current task IPs — no hard-coded addresses.

---

## Step 5 — EKS deployment

### 5a. Point kubectl at the cluster

```bash
$(terraform -chdir=terraform output -raw eks_kubeconfig_command)
kubectl get nodes        # should list 2 ready nodes
```

### 5b. Install the AWS Load Balancer Controller (for the Ingress → ALB)

```bash
CLUSTER=$(terraform -chdir=terraform output -raw eks_cluster_name)
REGION=$(terraform -chdir=terraform output -raw region)
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
VPC_ID=$(aws eks describe-cluster --name $CLUSTER --region $REGION \
  --query 'cluster.resourcesVpcConfig.vpcId' --output text)

# IAM policy + IRSA service account
curl -s -o iam-policy.json https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.7.2/docs/install/iam_policy.json
aws iam create-policy --policy-name AWSLoadBalancerControllerIAMPolicy \
  --policy-document file://iam-policy.json 2>/dev/null || true

eksctl utils associate-iam-oidc-provider --cluster $CLUSTER --region $REGION --approve
eksctl create iamserviceaccount --cluster $CLUSTER --region $REGION \
  --namespace kube-system --name aws-load-balancer-controller \
  --attach-policy-arn arn:aws:iam::$ACCOUNT:policy/AWSLoadBalancerControllerIAMPolicy \
  --approve

helm repo add eks https://aws.github.io/eks-charts && helm repo update
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system --set clusterName=$CLUSTER \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set region=$REGION --set vpcId=$VPC_ID
```

> Don't have `eksctl`? `brew install eksctl`. The controller is only needed for
> the public Ingress; everything else works without it.

### 5c. Point the manifests at your images and apply

```bash
ECR=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com
sed -i '' "s|<ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com|$ECR|g" \
  eks/30-products.yaml eks/35-cart.yaml eks/40-frontend.yaml

kubectl apply -f eks/
kubectl get pods -n shopnow -w
```

### 5d. Get the public URL

```bash
kubectl get ingress -n shopnow shopnow \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'; echo
```

**How service discovery is wired:** Kubernetes gives every Service a stable DNS
name in its namespace. The frontend reaches `http://products:5001` and
`http://cart:5002`; products reaches `postgres`, cart reaches `redis` — all by
name. Each `ClusterIP` Service load-balances across that service's 2 pods
automatically.

---

## Step 6 — Resiliency: kill a container/pod and watch it heal

Both orchestrators run a reconciliation loop: declare *desired state*, and the
controller restores it after a failure.

### ECS

```bash
CLUSTER=shopnow-ecs
# Pick one running products task and stop it:
TASK=$(aws ecs list-tasks --cluster $CLUSTER --service-name products \
  --region $REGION --query 'taskArns[0]' --output text)
aws ecs stop-task --cluster $CLUSTER --task $TASK --region $REGION

# Watch ECS launch a replacement back to desired_count=2:
watch -n2 "aws ecs describe-services --cluster $CLUSTER --services products \
  --region $REGION --query 'services[0].{running:runningCount,desired:desiredCount}'"
```

The app stays up the whole time because the other products task keeps serving;
refresh the page and the Products card's `served by` shows a new task ID once the
replacement is up. (The Cart service is unaffected — that's the microservices
blast-radius benefit.)

### EKS

```bash
kubectl get pods -n shopnow
# Delete one products pod:
kubectl delete pod -n shopnow $(kubectl get pod -n shopnow -l app=products \
  -o jsonpath='{.items[0].metadata.name}')

# The ReplicaSet immediately schedules a new one:
kubectl get pods -n shopnow -w
```

Or simulate a crash and watch the liveness probe + restart counter:

```bash
kubectl exec -n shopnow deploy/products -- kill 1
kubectl get pods -n shopnow      # RESTARTS column ticks up, pod returns to Running
```

In both cases: **no manual intervention, app recovers automatically, zero
downtime** thanks to running 2 replicas behind a load balancer.

---

## ECS vs EKS — what the benchmark shows

| Dimension              | ECS (Fargate)                                  | EKS                                              |
|------------------------|------------------------------------------------|-------------------------------------------------|
| Setup complexity       | Low — AWS-native, fewer moving parts           | Higher — control plane + addons + LB controller |
| Servers to manage      | None (serverless Fargate)                      | Node groups (or Fargate profiles)               |
| Service discovery      | Cloud Map (`*.shopnow.local`)                  | Built-in kube-dns (`*.svc.cluster.local`)       |
| Load balancing         | ALB + target groups (native)                   | Ingress → ALB via LB Controller; Service for L4  |
| Control-plane cost     | $0                                             | ~$0.10/hr per cluster                            |
| Portability            | AWS-locked                                      | Portable (any K8s)                               |
| Ecosystem              | AWS console/CLI/IaC                            | Huge CNCF ecosystem (Helm, operators, etc.)     |
| Best for               | Teams wanting simplicity & speed on AWS         | Teams wanting K8s portability & flexibility      |

**Rule of thumb for ShopNow:** start on **ECS Fargate** for fastest time-to-prod
with the least ops burden; move to **EKS** when you need multi-cloud portability,
advanced scheduling, or the Kubernetes ecosystem.

---

## Cleanup (avoid surprise bills)

```bash
# EKS workloads + the ALB the Ingress created:
kubectl delete -f eks/ 2>/dev/null
helm uninstall aws-load-balancer-controller -n kube-system 2>/dev/null

# Everything Terraform made:
cd terraform && terraform destroy
```

> If `terraform destroy` stalls on the VPC, it's usually because the EKS Ingress
> ALB or its security groups still exist — delete the Ingress first (above), then
> destroy again.

---

## Design notes / caveats

- **Stateful tiers are demo-grade.** Postgres/Redis run as single replicas with
  ephemeral storage on both platforms. For production use Amazon RDS + ElastiCache
  (or StatefulSets + EBS PVCs on EKS) and store credentials in Secrets Manager.
- **Microservices + database-per-service.** Products and Cart are independently
  deployable, independently scalable, and own their own datastore. Killing one
  doesn't take down the other.
- **Same images, two runtimes.** The only per-environment change is the service
  URLs (`PRODUCTS_URL` / `CART_URL`), proving the containers are portable.
- **Secrets** are inline here for clarity only. Replace with AWS Secrets Manager
  (ECS `secrets`) / Kubernetes external-secrets in production. This now includes
  the shared `JWT_SECRET` — it must be identical for the Products and Cart
  services (they both verify the same auth tokens). It's a Terraform `jwt_secret`
  variable for ECS and the `app-secrets` Secret for EKS.
- **Payments are mocked.** Checkout runs a deterministic in-process gateway (any
  card ending `0000` is declined); no real charge, no external keys. Swap in a
  real PSP (Stripe, etc.) at the `POST /api/orders` boundary for production.
- **The frontend has a build step.** The Angular app under `app/frontend/web` is
  compiled during the Docker image build (multi-stage); the runtime image just
  serves the static bundle and proxies `/api`. The image is still environment-
  agnostic — same image on ECS and EKS.
