# =====================================================================
# ECS (Fargate) stack — gated by var.enable_ecs.
#   Frontend  -> public Application Load Balancer
#   Products  -> products.shopnow.local  (Cloud Map) -> Postgres
#   Cart      -> cart.shopnow.local      (Cloud Map) -> Redis
#   Postgres  -> postgres.shopnow.local  (Fargate, ephemeral storage)
#   Redis     -> redis.shopnow.local
# Database-per-service: only Products touches Postgres, only Cart touches Redis.
# =====================================================================

locals {
  ecs_count      = var.enable_ecs ? 1 : 0
  ecs_image_fe   = "${aws_ecr_repository.this["frontend"].repository_url}:latest"
  ecs_image_prod = "${aws_ecr_repository.this["products"].repository_url}:latest"
  ecs_image_cart = "${aws_ecr_repository.this["cart"].repository_url}:latest"
}

# ---- Cluster + logging ----
resource "aws_ecs_cluster" "this" {
  count = local.ecs_count
  name  = "${var.project}-ecs"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "ecs" {
  count             = local.ecs_count
  name              = "/ecs/${var.project}"
  retention_in_days = 7
}

# ---- IAM: task execution role (pull from ECR, write logs) ----
data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  count              = local.ecs_count
  name               = "${var.project}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  count      = local.ecs_count
  role       = aws_iam_role.ecs_execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# ---- Service Discovery (Cloud Map private DNS namespace) ----
resource "aws_service_discovery_private_dns_namespace" "this" {
  count       = local.ecs_count
  name        = "shopnow.local"
  description = "Service discovery for ShopNow on ECS"
  vpc         = module.vpc.vpc_id
}

# One Cloud Map service per discoverable workload.
resource "aws_service_discovery_service" "svc" {
  for_each = var.enable_ecs ? toset(["products", "cart", "postgres", "redis"]) : toset([])
  name     = each.key
  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.this[0].id
    routing_policy = "MULTIVALUE"
    dns_records {
      type = "A"
      ttl  = 10
    }
  }
  health_check_custom_config { failure_threshold = 1 }
}

# ---- Security groups ----
resource "aws_security_group" "alb" {
  count       = local.ecs_count
  name        = "${var.project}-ecs-alb"
  description = "Public ALB for ECS frontend"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "HTTP from anywhere"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ecs_tasks" {
  count       = local.ecs_count
  name        = "${var.project}-ecs-tasks"
  description = "ShopNow Fargate tasks"
  vpc_id      = module.vpc.vpc_id

  # Frontend traffic from the ALB only.
  ingress {
    description     = "frontend from ALB"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb[0].id]
  }
  # All tiers talk to each other within this SG
  # (frontend->products/cart, products->postgres, cart->redis).
  ingress {
    description = "intra-service traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    self        = true
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ---- Application Load Balancer (frontend) ----
resource "aws_lb" "frontend" {
  count              = local.ecs_count
  name               = "${var.project}-ecs-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb[0].id]
  subnets            = module.vpc.public_subnets
}

resource "aws_lb_target_group" "frontend" {
  count       = local.ecs_count
  name        = "${var.project}-ecs-fe"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "ip" # required for Fargate (awsvpc)

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
  }
}

resource "aws_lb_listener" "frontend" {
  count             = local.ecs_count
  load_balancer_arn = aws_lb.frontend[0].arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend[0].arn
  }
}

# ---- Task definitions ----
resource "aws_ecs_task_definition" "postgres" {
  count                    = local.ecs_count
  family                   = "${var.project}-postgres"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution[0].arn

  container_definitions = jsonencode([{
    name         = "postgres"
    image        = "postgres:16-alpine"
    essential    = true
    portMappings = [{ containerPort = 5432 }]
    environment = [
      { name = "POSTGRES_USER", value = "shopnow" },
      { name = "POSTGRES_PASSWORD", value = var.db_password },
      { name = "POSTGRES_DB", value = "shopnow" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.ecs[0].name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "postgres"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "redis" {
  count                    = local.ecs_count
  family                   = "${var.project}-redis"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution[0].arn

  container_definitions = jsonencode([{
    name         = "redis"
    image        = "redis:7-alpine"
    essential    = true
    portMappings = [{ containerPort = 6379 }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.ecs[0].name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "redis"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "products" {
  count                    = local.ecs_count
  family                   = "${var.project}-products"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution[0].arn

  container_definitions = jsonencode([{
    name         = "products"
    image        = local.ecs_image_prod
    essential    = true
    portMappings = [{ containerPort = 5001 }]
    environment = [
      { name = "PG_HOST", value = "postgres.shopnow.local" },
      { name = "PG_USER", value = "shopnow" },
      { name = "PG_PASSWORD", value = var.db_password },
      { name = "PG_DATABASE", value = "shopnow" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.ecs[0].name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "products"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "cart" {
  count                    = local.ecs_count
  family                   = "${var.project}-cart"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution[0].arn

  container_definitions = jsonencode([{
    name         = "cart"
    image        = local.ecs_image_cart
    essential    = true
    portMappings = [{ containerPort = 5002 }]
    environment = [
      { name = "REDIS_HOST", value = "redis.shopnow.local" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.ecs[0].name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "cart"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "frontend" {
  count                    = local.ecs_count
  family                   = "${var.project}-frontend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution[0].arn

  container_definitions = jsonencode([{
    name         = "frontend"
    image        = local.ecs_image_fe
    essential    = true
    portMappings = [{ containerPort = 8080 }]
    environment = [
      # Service discovery: reach each microservice by its Cloud Map DNS name.
      { name = "PRODUCTS_URL", value = "http://products.shopnow.local:5001" },
      { name = "CART_URL", value = "http://cart.shopnow.local:5002" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.ecs[0].name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "frontend"
      }
    }
  }])
}

# ---- Services ----
resource "aws_ecs_service" "postgres" {
  count           = local.ecs_count
  name            = "postgres"
  cluster         = aws_ecs_cluster.this[0].id
  task_definition = aws_ecs_task_definition.postgres[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.ecs_tasks[0].id]
  }
  service_registries {
    registry_arn = aws_service_discovery_service.svc["postgres"].arn
  }
}

resource "aws_ecs_service" "redis" {
  count           = local.ecs_count
  name            = "redis"
  cluster         = aws_ecs_cluster.this[0].id
  task_definition = aws_ecs_task_definition.redis[0].arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.ecs_tasks[0].id]
  }
  service_registries {
    registry_arn = aws_service_discovery_service.svc["redis"].arn
  }
}

resource "aws_ecs_service" "products" {
  count           = local.ecs_count
  name            = "products"
  cluster         = aws_ecs_cluster.this[0].id
  task_definition = aws_ecs_task_definition.products[0].arn
  desired_count   = 2 # 2 tasks so load balancing / self-healing is observable
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.ecs_tasks[0].id]
  }
  service_registries {
    registry_arn = aws_service_discovery_service.svc["products"].arn
  }
  depends_on = [aws_ecs_service.postgres]
}

resource "aws_ecs_service" "cart" {
  count           = local.ecs_count
  name            = "cart"
  cluster         = aws_ecs_cluster.this[0].id
  task_definition = aws_ecs_task_definition.cart[0].arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.ecs_tasks[0].id]
  }
  service_registries {
    registry_arn = aws_service_discovery_service.svc["cart"].arn
  }
  depends_on = [aws_ecs_service.redis]
}

resource "aws_ecs_service" "frontend" {
  count           = local.ecs_count
  name            = "frontend"
  cluster         = aws_ecs_cluster.this[0].id
  task_definition = aws_ecs_task_definition.frontend[0].arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = module.vpc.private_subnets
    security_groups = [aws_security_group.ecs_tasks[0].id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.frontend[0].arn
    container_name   = "frontend"
    container_port   = 8080
  }
  depends_on = [aws_lb_listener.frontend, aws_ecs_service.products, aws_ecs_service.cart]
}
