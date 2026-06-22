# ShopNow — ECS vs EKS Benchmark: Presentation Walkthrough

**For presenting to the CTO.** This is the script for walking the boss through what
you built and why, ending in a recommendation. It's written as *what you say* →
*what you show* → *the command behind it*.

> The CTO asked one question: **"Should ShopNow run on ECS Fargate or EKS?"**
> Your answer isn't an opinion — it's a working benchmark. You built the *same* app,
> deployed it *both* ways, and you'll prove each one runs and self-heals, then give a
> recommendation backed by what you saw.

**Run the [Pre-flight appendix](#appendix-a--pre-flight-run-this-before-the-meeting)
before the meeting** so everything is live when you start. Never provision in front of
the boss — it's slow and flaky. Walk in with both URLs already green.

---

## The 6-minute arc (what you're walking them through)

1. **The ask** — remind them what they wanted and how you answered it.
2. **The product** — one real app, containerized once.
3. **The fair test** — same images, same network; only the runtime differs.
4. **Environment A: ECS Fargate** — show it live, explain it in business terms.
5. **Environment B: EKS** — show it live, name the trade-off.
6. **The proof that matters** — kill a server in each; customers never notice.
7. **The recommendation** — the verdict, the cost, the migration path.

Keep the laptop on the two browser tabs (ECS storefront, EKS storefront) and one
terminal. Total talk time ~10–12 min plus questions.

---

## 1. The ask — set the frame (~30 sec)

> "You asked me to figure out whether we should run ShopNow on **ECS Fargate** or
> **EKS** before we commit. Rather than give you an opinion, I built the *actual*
> storefront, deployed the *same* containers to *both* platforms on AWS, and I'll show
> you each one working — including what happens when a server dies. Then I'll give you
> my recommendation."

Nothing to show yet — just orient them.

---

## 2. The product — one real app (~1.5 min)

> "First, this isn't a toy. It's a full storefront — customers browse a catalog, log in,
> add to cart, check out through a payment step, and there's an admin panel to manage
> products and orders."

**Show:** open the **ECS storefront tab**, log in as `demo@shopnow.local` / `demo123`,
search a product, add to cart. Then the admin view with `admin@shopnow.local` / `admin123`.

> "Under the hood it's three independent services — a frontend, a products/catalog API
> on Postgres, and a cart service on Redis — each in its own container. That
> microservices shape is exactly why the ECS-vs-EKS comparison is meaningful: real apps
> look like this."

**Show (optional):** the architecture diagram at the top of [README.md](../README.md).

---

## 3. The fair test — why this benchmark is trustworthy (~1 min)

> "The most important thing about this comparison: it's *apples to apples*. Same exact
> container images on both platforms. Same shared network. The **only** thing that
> changes between ECS and EKS is how a service finds another service by name — and even
> that's just two environment variables. So any difference you see is the platform, not
> the app."

**Show:** [docker-compose.yml](../docker-compose.yml) — point at `PRODUCTS_URL` /
`CART_URL`. "These service names are the *only* per-environment setting."

```bash
ls app/*/Dockerfile      # frontend (multi-stage build), products, cart — containerized once
```

---

## 4. Environment A — ECS Fargate (~2 min)

> "Here's ShopNow running on **ECS Fargate**. Fargate means **we run zero servers** —
> no EC2 to patch, no capacity to manage. AWS runs the containers; we just say 'keep two
> of each alive.'"

**Show:** the ECS storefront tab is already open and working.

> "Customers come in through a public load balancer. Behind it, the frontend finds the
> products and cart services **by name** — `products.shopnow.local` — through AWS's
> service-discovery, never a hard-coded address. If a container moves, the name still
> resolves."

**Show the services holding steady:**
```bash
aws ecs describe-services --cluster shopnow-ecs --services frontend products cart \
  --region us-east-1 \
  --query 'services[].{service:serviceName,running:runningCount,desired:desiredCount}' --output table
```
> "Two of each, all healthy. This is all defined in code — [terraform/ecs.tf](../terraform/ecs.tf) —
> so we can recreate it in any region in minutes."

**Optional proof of load balancing:** refresh the storefront twice — the Products card's
`served by` ID changes. "Different instances answering — the load balancer is spreading
traffic across both copies."

---

## 5. Environment B — EKS (~2 min)

> "Now the *exact same app* on **EKS** — managed Kubernetes. Same images, same behavior.
> The difference is what it takes to get here and what we get in return."

**Show:** switch to the EKS storefront tab — log in, it behaves identically.

> "Kubernetes gives every service a built-in name too, so discovery works the same way
> from the app's point of view. The public entrypoint is a load balancer created from
> this Ingress definition."

**Show the running workloads:**
```bash
kubectl get deploy,svc,ingress -n shopnow
kubectl get pods -n shopnow            # 2 frontend / 2 products / 2 cart + postgres + redis
```
> "Same two-of-each layout. But notice what EKS *added*: a control plane we pay for
> hourly, worker nodes we now own and patch, and an add-on controller I had to install
> just to get that public load balancer. More power, more moving parts — hold that
> thought for the recommendation."

---

## 6. The proof that matters — resiliency (~3 min, the centerpiece)

> "You care about one thing operationally: **does the store stay up when something
> fails?** Let me not tell you — let me show you. I'm going to kill a server in each
> environment, live, and watch the platform heal itself with nobody touching anything."

**ECS — kill a running task:**
```bash
TASK=$(aws ecs list-tasks --cluster shopnow-ecs --service-name products --region us-east-1 \
  --query 'taskArns[0]' --output text)
aws ecs stop-task --cluster shopnow-ecs --task $TASK --region us-east-1 >/dev/null
echo "killed a products server — refresh the storefront."
```
> "I just killed one of the two products servers. Refresh the store — *still working*,
> because the second one carried the load. And watch ECS bring the dead one back:"
```bash
watch -n2 "aws ecs describe-services --cluster shopnow-ecs --services products --region us-east-1 \
  --query 'services[0].{running:runningCount,desired:desiredCount}'"
```
> "Running drops to 1, then ECS launches a replacement back to 2. No pager, no human." (`Ctrl-C` once recovered.)

**EKS — kill a pod (have a watch already running in a second pane):**
```bash
# Pane A — start this first:
kubectl get pods -n shopnow -l app=products -w
# Pane B — kill one:
kubectl delete pod -n shopnow $(kubectl get pod -n shopnow -l app=products \
  -o jsonpath='{.items[0].metadata.name}')
```
> "Same story on Kubernetes — the pod dies and a fresh one is already starting within
> seconds. The store never blinked."

**Land it:**
> "ECS replaced a task, EKS rescheduled a pod — two different mechanisms, **same
> guarantee**: declare what you want, the platform keeps it true. That's the whole
> reason we use an orchestrator instead of running containers by hand."

---

## 7. The recommendation — answer the question (~1.5 min)

**Show:** the comparison table in
[README.md](../README.md#ecs-vs-eks--what-the-benchmark-shows).

> "Same app, both platforms, both self-healing. So here's my read:
>
> - **ECS Fargate** — simplest path. No servers, fewer moving parts, nothing extra to
>   install, and **no control-plane bill**. Fastest for us to ship and operate on AWS.
> - **EKS** — more powerful and portable: it's standard Kubernetes, so we're not locked
>   to AWS and we get the whole ecosystem. But it costs a control plane (~$0.10/hr per
>   cluster), nodes we have to manage, and more operational surface.
>
> **My recommendation: start on ECS Fargate.** It gets ShopNow to production fastest
> with the least ops burden, and because everything is containerized and defined in
> code, the move to EKS later — if we ever need multi-cloud or advanced Kubernetes
> features — is straightforward. We'd be choosing simplicity now without painting
> ourselves into a corner."

> **Cost note if asked:** "This benchmark runs a NAT gateway, two load balancers, the
> EKS control plane, and two nodes — a few dollars for the demo. I'm tearing it down
> right after this so it costs us nothing going forward."

---

## Anticipated CTO questions (have these ready)

| If they ask… | Say… |
|---|---|
| **"What does each cost to run?"** | "ECS Fargate: you pay per container-second, no control-plane fee. EKS adds ~$0.10/hr per cluster *plus* the worker nodes whether busy or not. For our scale, ECS is cheaper until we're running a lot of services." |
| **"Are we locked into AWS with ECS?"** | "Somewhat — ECS is AWS-only. But the *containers* are portable; only the orchestration config is AWS-specific. EKS is portable Kubernetes. That portability is the main reason you'd pay the EKS premium." |
| **"How does it scale under load?"** | "Both auto-scale on metrics. ECS scales tasks; EKS scales pods and can add nodes. Same idea — we set a target, it grows and shrinks." |
| **"Is it secure / are secrets safe?"** | "For this benchmark, secrets are inline for clarity — flagged in the docs. In production they move to AWS Secrets Manager (ECS) or sealed secrets (EKS), and we'd add HTTPS at the load balancer. It's a known, small follow-up." |
| **"What about the database?"** | "Postgres and Redis run as single demo containers here. In production they become managed RDS and ElastiCache — more reliable and backed up — without changing the app." |
| **"How fast could we go live?"** | "On ECS, very fast — it's all in Terraform, one command per environment. The app and pipeline already exist; we'd harden secrets and the database and ship." |
| **"Why should I trust the comparison?"** | "Because it's the same image set and the same network on both. I changed nothing about the app between platforms — only which orchestrator runs it." |

---

# Appendix A — Pre-flight (run this BEFORE the meeting)

> EKS + the load balancer take ~20 min to come up. Do all of this 30–45 min early and
> confirm both storefront URLs load. Walk in with green tabs.

### A0. Shell setup (paste at the top of your terminal)
```bash
cd ~/Desktop/Amalitech/Poly-Orchestrator
export AWS_PROFILE=shopnow          # the shopnow-terraform IAM user (NOT the DCE creds)
aws sts get-caller-identity         # MUST show user/shopnow-terraform
export REGION=$(terraform -chdir=terraform output -raw region)
export ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export ECR=$ACCOUNT.dkr.ecr.$REGION.amazonaws.com
export CLUSTER_ECS=$(terraform -chdir=terraform output -raw ecs_cluster_name)
export CLUSTER_EKS=$(terraform -chdir=terraform output -raw eks_cluster_name)
export ECS_URL=$(terraform -chdir=terraform output -raw ecs_frontend_url)
```

### A1. Provision both stacks
```bash
cd terraform && terraform init && terraform apply -auto-approve && cd ..   # ~15 min
```

### A2. Build & push images
```bash
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR
for svc in frontend products cart; do
  docker build --platform linux/amd64 -t $ECR/shopnow/$svc:latest ./app/$svc
  docker push $ECR/shopnow/$svc:latest
done
for s in postgres redis products cart frontend; do
  aws ecs update-service --cluster $CLUSTER_ECS --service $s --force-new-deployment --region $REGION >/dev/null
done
```

### A3. Wire up EKS (kubectl + ALB controller + workloads)
```bash
$(terraform -chdir=terraform output -raw eks_kubeconfig_command)
kubectl get nodes
VPC_ID=$(aws eks describe-cluster --name $CLUSTER_EKS --region $REGION --query 'cluster.resourcesVpcConfig.vpcId' --output text)
curl -s -o iam-policy.json https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.7.2/docs/install/iam_policy.json
aws iam create-policy --policy-name AWSLoadBalancerControllerIAMPolicy --policy-document file://iam-policy.json 2>/dev/null || true
eksctl utils associate-iam-oidc-provider --cluster $CLUSTER_EKS --region $REGION --approve
eksctl create iamserviceaccount --cluster $CLUSTER_EKS --region $REGION \
  --namespace kube-system --name aws-load-balancer-controller \
  --attach-policy-arn arn:aws:iam::$ACCOUNT:policy/AWSLoadBalancerControllerIAMPolicy --approve
helm repo add eks https://aws.github.io/eks-charts && helm repo update
helm install aws-load-balancer-controller eks/aws-load-balancer-controller -n kube-system \
  --set clusterName=$CLUSTER_EKS --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller --set region=$REGION --set vpcId=$VPC_ID
sed -i '' "s|<ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com|$ECR|g" eks/30-products.yaml eks/35-cart.yaml eks/40-frontend.yaml
kubectl apply -f eks/
```

### A4. Green-light checklist (ALL must pass)
```bash
aws ecs describe-services --cluster $CLUSTER_ECS --services frontend products cart --region $REGION \
  --query 'services[].{n:serviceName,r:runningCount,d:desiredCount}' --output table
curl -s $ECS_URL/health
export EKS_URL=http://$(kubectl get ingress -n shopnow shopnow -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
curl -s $EKS_URL/health
echo "ECS: $ECS_URL"; echo "EKS: $EKS_URL"
```
Open both URLs, log in with `demo@shopnow.local` / `demo123`, leave the tabs up.

---

# Appendix B — If something breaks live

| Symptom | Recovery |
|---|---|
| ECS URL 503 | A task is still converging — use it *as* the resiliency story. |
| EKS Ingress has no hostname | `kubectl port-forward -n shopnow svc/frontend 9090:80` → `open http://localhost:9090`. |
| EKS pods `ImagePullBackOff` | The `sed` didn't run; re-run it, then `kubectl rollout restart deploy -n shopnow`. |
| `served by` IDs identical | Hard-refresh (Cmd-Shift-R) or `curl $ECS_URL/api/products` a few times. |
| Identity is `DCEPrincipal-dce` | Wrong creds — `export AWS_PROFILE=shopnow` after `unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN`. |

**Screenshot insurance:** during pre-flight, capture both storefronts, both healthy-status
tables, and one completed kill-and-recover. If networking dies live, narrate the screenshots.

---

# Appendix C — Teardown (right after the meeting)

```bash
kubectl delete -f eks/
helm uninstall aws-load-balancer-controller -n kube-system
terraform -chdir=terraform destroy -auto-approve
git checkout eks/                 # undo the sed image edits
```
> If `destroy` stalls on the VPC, the Ingress ALB is usually still deleting — confirm
> `kubectl delete -f eks/` finished, then destroy again.
</content>
