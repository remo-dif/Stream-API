pipeline {
  agent any

  options {
    buildDiscarder(logRotator(numToKeepStr: '10'))
    timeout(time: 30, unit: 'MINUTES')
    disableConcurrentBuilds()
    timestamps()
  }

  environment {
    // Registry namespace is non-secret. Credentials are supplied by dockerhub-credentials.
    REGISTRY = 'docker.io/remo-dif'
    IMAGE_NAME = 'stream-api'
    CI = 'true'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        script {
          env.GIT_SHA = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()

          def branch = env.BRANCH_NAME ?: sh(script: 'git rev-parse --abbrev-ref HEAD', returnStdout: true).trim()
          env.BRANCH_NAME = branch

          if (branch == 'staging') {
            env.DEPLOY_ENV = 'staging'
            env.DOCKERFILE = 'infrastructure/docker/Dockerfile.staging'
            env.COMPOSE_FILE = 'infrastructure/docker/docker-compose.staging.yml'
          } else if (branch == 'main' || branch == 'master') {
            env.DEPLOY_ENV = 'production'
            env.DOCKERFILE = 'infrastructure/docker/Dockerfile.production'
            env.COMPOSE_FILE = 'infrastructure/docker/docker-compose.production.yml'
          } else {
            // develop and feature/* both use the development container contract.
            env.DEPLOY_ENV = 'dev'
            env.DOCKERFILE = 'infrastructure/docker/Dockerfile.dev'
            env.COMPOSE_FILE = 'infrastructure/docker/docker-compose.dev.yml'
          }

          env.IMAGE_TAG = "${env.REGISTRY}/${env.IMAGE_NAME}:${env.DEPLOY_ENV}-${env.GIT_SHA}"
          env.LATEST_TAG = "${env.REGISTRY}/${env.IMAGE_NAME}:${env.DEPLOY_ENV}-latest"
        }
      }
    }

    stage('Install') {
      steps {
        sh 'npm ci'
      }
    }

    stage('Lint') {
      steps {
        sh 'npm run lint'
      }
    }

    stage('Test') {
      steps {
        sh '''
          set -eu
          docker compose -f infrastructure/docker/docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from backend-test
        '''
      }
      post {
        always {
          junit allowEmptyResults: false, testResults: 'coverage/junit.xml'
          publishHTML([
            allowMissing: false,
            alwaysLinkToLastBuild: true,
            keepAll: true,
            reportDir: 'coverage/lcov-report',
            reportFiles: 'index.html',
            reportName: 'Coverage Report'
          ])
          sh 'docker compose -f infrastructure/docker/docker-compose.test.yml down --remove-orphans || true'
        }
      }
    }

    stage('Build') {
      steps {
        sh 'npm run build'
      }
    }

    stage('Docker Build & Push') {
      when {
        expression { !(env.BRANCH_NAME ?: '').startsWith('feature/') }
      }
      steps {
        withCredentials([usernamePassword(credentialsId: 'dockerhub-credentials', usernameVariable: 'DOCKERHUB_USERNAME', passwordVariable: 'DOCKERHUB_PASSWORD')]) {
          sh '''
            set -eu
            echo "$DOCKERHUB_PASSWORD" | docker login --username "$DOCKERHUB_USERNAME" --password-stdin
            docker build -f "$DOCKERFILE" -t "$IMAGE_TAG" -t "$LATEST_TAG" .
            docker push "$IMAGE_TAG"
            docker push "$LATEST_TAG"
          '''
        }
      }
    }

    stage('Deploy') {
      when {
        expression { !(env.BRANCH_NAME ?: '').startsWith('feature/') }
      }
      steps {
        withCredentials([
          string(credentialsId: 'SUPABASE_URL', variable: 'SUPABASE_URL'),
          string(credentialsId: 'SUPABASE_KEY', variable: 'SUPABASE_KEY'),
          string(credentialsId: 'ANTHROPIC_API_KEY', variable: 'ANTHROPIC_API_KEY'),
          string(credentialsId: 'REDIS_URL', variable: 'REDIS_URL'),
          string(credentialsId: 'DATABASE_URL', variable: 'DATABASE_URL'),
          string(credentialsId: 'JWT_SECRET', variable: 'JWT_SECRET')
        ]) {
          sh '''
            set -eu
            docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans
          '''
        }
      }
    }

    stage('Health Check') {
      when {
        expression { !(env.BRANCH_NAME ?: '').startsWith('feature/') }
      }
      steps {
        sh '''
          set -eu
          for attempt in 1 2 3 4 5; do
            if curl --fail --silent --show-error http://localhost:3000/health; then
              exit 0
            fi

            echo "Health check attempt ${attempt}/5 failed; retrying in 5 seconds."
            sleep 5
          done

          echo "Health check failed after 5 attempts."
          exit 1
        '''
      }
    }
  }

  post {
    always {
      sh 'docker logout || true'
      cleanWs()
    }
    failure {
      echo "Pipeline failed for branch ${env.BRANCH_NAME ?: 'unknown'}, SHA ${env.GIT_SHA ?: 'unknown'}, environment ${env.DEPLOY_ENV ?: 'unknown'}"
    }
    success {
      echo "Successfully deployed ${env.IMAGE_TAG ?: 'no-image-for-this-branch'}"
    }
  }
}
