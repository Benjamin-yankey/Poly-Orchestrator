// ShopNow CI/CD — build the 3 service images, push to ECR, and redeploy to
// BOTH ECS (Fargate) and EKS on every commit.
//
// This pipeline FANS OUT: the 3 images build+push in parallel, then ECS and
// EKS redeploy in parallel. Blue Ocean renders each parallel branch as its own
// lane, so you can watch all of them at once. See docs/CICD-JENKINS.md.
//
// Auth (local Jenkins): AWS keys are injected from the Jenkins credentials
// store. Create two "Secret text" credentials with these exact IDs:
//   aws-access-key-id      -> your AWS_ACCESS_KEY_ID
//   aws-secret-access-key  -> your AWS_SECRET_ACCESS_KEY
// (If Jenkins later runs on AWS, drop these for an instance profile / IRSA.)
// The agent must have docker, aws CLI v2, kubectl, and git on PATH.

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  parameters {
    string(name: 'AWS_REGION', defaultValue: 'us-east-1', description: 'AWS region')
    string(name: 'PROJECT', defaultValue: 'shopnow', description: 'Project / ECR namespace prefix')
    booleanParam(name: 'DEPLOY_ECS', defaultValue: true, description: 'Redeploy ECS services')
    booleanParam(name: 'DEPLOY_EKS', defaultValue: true, description: 'Redeploy EKS deployments')
  }

  environment {
    SERVICES    = 'frontend products cart'
    ECS_CLUSTER = "${params.PROJECT}-ecs"
    EKS_CLUSTER = "${params.PROJECT}-eks"
    K8S_NS      = 'shopnow'

    AWS_DEFAULT_REGION    = "${params.AWS_REGION}"
    AWS_ACCESS_KEY_ID     = credentials('aws-access-key-id')
    AWS_SECRET_ACCESS_KEY = credentials('aws-secret-access-key')
  }

  stages {
    stage('Checkout') {
      steps {
        // Clone over HTTPS using the 'github-token' credential
        // (Username with password: GitHub username + PAT).
        git branch: 'main',
            credentialsId: 'github-token',
            url: 'https://github.com/Benjamin-yankey/Poly-Orchestrator.git'
      }
    }

    stage('Resolve account & tag') {
      steps {
        script {
          env.AWS_ACCOUNT_ID = sh(script: 'aws sts get-caller-identity --query Account --output text', returnStdout: true).trim()
          env.ECR = "${env.AWS_ACCOUNT_ID}.dkr.ecr.${params.AWS_REGION}.amazonaws.com"
          // Immutable, traceable tag = short git SHA (falls back to build number).
          env.IMAGE_TAG = sh(script: "git rev-parse --short HEAD 2>/dev/null || echo build-${BUILD_NUMBER}", returnStdout: true).trim()
        }
        echo "Registry: ${env.ECR} | tag: ${env.IMAGE_TAG}"
      }
    }

    stage('Login to ECR') {
      steps {
        sh '''
          aws ecr get-login-password --region "${AWS_REGION}" \
            | docker login --username AWS --password-stdin "${ECR}"
        '''
      }
    }

    stage('Build & push images') {
      steps {
        script {
          // One parallel branch per service. Each builds + pushes independently;
          // Blue Ocean shows them as 3 concurrent lanes under this stage.
          def branches = [:]
          for (svc in env.SERVICES.split()) {
            def name = svc            // capture per-iteration value for the closure
            branches["build-${name}"] = {
              stage("build ${name}") {
                sh """
                  set -e
                  echo '==> building & pushing ${name}'
                  docker build --platform linux/amd64 \
                    -t '${env.ECR}/${params.PROJECT}/${name}:${env.IMAGE_TAG}' \
                    -t '${env.ECR}/${params.PROJECT}/${name}:latest' \
                    './app/${name}'
                  docker push '${env.ECR}/${params.PROJECT}/${name}:${env.IMAGE_TAG}'
                  docker push '${env.ECR}/${params.PROJECT}/${name}:latest'
                """
              }
            }
          }
          parallel branches
        }
      }
    }

    stage('Deploy') {
      parallel {
        stage('Deploy to ECS') {
          when { expression { return params.DEPLOY_ECS } }
          steps {
            // ECS task definitions reference :latest, so a forced new deployment
            // makes ECS re-pull the freshly pushed image (rolling, zero-downtime).
            sh '''
              set -e
              for svc in postgres redis ${SERVICES}; do
                status=$(aws ecs describe-services --cluster "${ECS_CLUSTER}" --services "$svc" \
                  --region "${AWS_REGION}" --query 'services[0].status' --output text 2>/dev/null || echo MISSING)
                if [ "$status" = "ACTIVE" ]; then
                  aws ecs update-service --cluster "${ECS_CLUSTER}" --service "$svc" \
                    --force-new-deployment --region "${AWS_REGION}" >/dev/null
                  echo "ECS redeploy triggered: $svc"
                else
                  echo "ECS service $svc not ACTIVE ($status) — skipping"
                fi
              done
            '''
          }
        }

        stage('Deploy to EKS') {
          when { expression { return params.DEPLOY_EKS } }
          steps {
            // Pin each Deployment to the immutable SHA tag — this updates the live
            // manifest AND triggers a rolling restart.
            sh '''
              set -e
              aws eks update-kubeconfig --name "${EKS_CLUSTER}" --region "${AWS_REGION}"
              for svc in ${SERVICES}; do
                kubectl -n "${K8S_NS}" set image "deployment/${svc}" \
                  "${svc}=${ECR}/${PROJECT}/${svc}:${IMAGE_TAG}"
                kubectl -n "${K8S_NS}" rollout status "deployment/${svc}" --timeout=180s
              done
            '''
          }
        }
      }
    }
  }

  post {
    success { echo "Shipped ${env.IMAGE_TAG} (ECS=${params.DEPLOY_ECS}, EKS=${params.DEPLOY_EKS})" }
    failure { echo 'Pipeline failed — check the stage logs above.' }
    always  { sh 'docker image prune -f >/dev/null 2>&1 || true' }
  }
}
