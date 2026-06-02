data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

# Shared network used by BOTH ECS and EKS so the comparison is apples-to-apples.
# Public subnets host the load balancers; private subnets host the workloads.
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.8"

  name = "${var.project}-vpc"
  cidr = var.vpc_cidr
  azs  = local.azs

  public_subnets  = ["10.0.0.0/20", "10.0.16.0/20"]
  private_subnets = ["10.0.128.0/20", "10.0.144.0/20"]

  enable_nat_gateway   = true
  single_nat_gateway   = true # one NAT to keep demo cost down
  enable_dns_hostnames = true
  enable_dns_support   = true

  # These tags let the AWS Load Balancer Controller on EKS auto-discover
  # which subnets to place public (ingress) and internal load balancers in.
  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
  }
}
