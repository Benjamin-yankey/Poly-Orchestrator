# =====================================================================
# EKS stack — gated by var.enable_eks.
# Creates the control plane + a managed node group in the private subnets.
# Workloads (the same images as ECS) are applied with kubectl from ./eks.
# =====================================================================

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.8"

  count = var.enable_eks ? 1 : 0

  cluster_name    = "${var.project}-eks"
  cluster_version = "1.30"

  cluster_endpoint_public_access = true

  # Give the identity running `terraform apply` admin access on the cluster
  # so you can immediately run kubectl after apply.
  enable_cluster_creator_admin_permissions = true

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  eks_managed_node_groups = {
    default = {
      instance_types = ["t3.medium"]
      min_size       = 2
      max_size       = 4
      desired_size   = 2
    }
  }

  # Core networking/DNS addons only. The EBS CSI driver was intentionally removed:
  # it requires an IRSA-backed IAM role to reach ACTIVE, and nothing here uses an
  # EBS-backed PersistentVolume (Postgres/Redis use ephemeral emptyDir for the demo).
  # If you later add a PVC, re-add aws-ebs-csi-driver WITH a service_account_role_arn.
  cluster_addons = {
    coredns    = {}
    kube-proxy = {}
    vpc-cni    = {}
  }
}
