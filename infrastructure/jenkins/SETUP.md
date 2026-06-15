# Jenkins and GitHub Setup for Stream-API

This guide configures Stream-API for branch-based CI/CD with Jenkins Multibranch Pipeline. Keep secrets in Jenkins Credentials only; never commit real values to `.env*` files.

## 1. Git Setup

Push all environment branches to GitHub:

```bash
git push origin master
git push origin main
git push origin staging
git push origin develop
```

Change the default branch to `main` in GitHub:

1. Open `remo-dif/Stream-API`.
2. Go to `Settings -> Branches`.
3. Under `Default branch`, select `main`.
4. Confirm the branch update.

Add branch protection rules for `main`, `staging`, and `develop`:

- Require a pull request before merging.
- Require status checks to pass before merging.
- Select the Jenkins Multibranch Pipeline status check.
- Require branches to be up to date before merging.
- Restrict direct pushes so changes flow through reviewed PRs.

Keep `master` during the transition so existing integrations do not break unexpectedly.

## 2. Jenkins Plugins

Install these plugins from `Manage Jenkins -> Plugins`:

- Pipeline
- GitHub Branch Source
- Docker Pipeline
- HTML Publisher
- JUnit
- Workspace Cleanup
- Timestamper

The Docker CLI is still used inside the `Jenkinsfile`; the Docker Pipeline plugin is installed so Jenkins can manage Docker-aware jobs and credentials cleanly.

## 3. Jenkins Credentials

Create credentials from `Manage Jenkins -> Credentials -> System -> Global credentials`.

| ID | Type | Description |
| --- | --- | --- |
| `dockerhub-credentials` | Username with password | Docker Hub username and token/password used to push Stream-API images. |
| `SUPABASE_URL` | Secret text | Supabase project URL for the target environment. |
| `SUPABASE_KEY` | Secret text | Supabase key injected into environment-specific Compose deployments. |
| `ANTHROPIC_API_KEY` | Secret text | Anthropic API key used when the Anthropic provider path is enabled. |
| `REDIS_URL` | Secret text | Redis connection URL for the target environment. |
| `DATABASE_URL` | Secret text | Database connection URL for the target environment. |
| `JWT_SECRET` | Secret text | JWT signing secret for the target environment. |

Use the exact credential IDs above. Jenkins resolves credentials by ID, so a naming mismatch fails the pipeline before deployment.

## 4. Multibranch Pipeline Job Setup

Create the job:

1. Open Jenkins.
2. Select `New Item`.
3. Enter `Stream-API`.
4. Select `Multibranch Pipeline`.
5. Add a `GitHub` branch source.
6. Set the repository URL to:

```text
https://github.com/remo-dif/Stream-API
```

7. Add GitHub credentials if Jenkins needs authenticated API access.
8. Set branch discovery filters to include:

```text
main
master
staging
develop
feature/*
```

9. Keep the Jenkinsfile path as:

```text
Jenkinsfile
```

10. Save the job and run `Scan Multibranch Pipeline Now`.

Branch behavior:

- `feature/*`: install, lint, test, and build only.
- `develop`: deploys with dev Docker and Compose files.
- `staging`: deploys with staging Docker and Compose files.
- `main` and `master`: deploy with production Docker and Compose files.

## 5. GitHub Webhook Setup

In GitHub, open `remo-dif/Stream-API -> Settings -> Webhooks -> Add webhook`.

Use this payload URL format:

```text
https://your-jenkins-domain/github-webhook/
```

Set:

- Content type: `application/json`
- Events: `push` and `pull_request`
- SSL verification: enabled when Jenkins has a valid HTTPS certificate

GitHub cannot reach `localhost`; if Jenkins runs locally, expose it through a secure tunnel or move Jenkins to a reachable server.

## 6. Per-Environment Deployment Checklist

Before deploying any environment:

- Confirm Jenkins credentials exist for all required secret IDs.
- Confirm Docker can build the selected environment Dockerfile.
- Confirm the selected Compose file validates with `docker compose config`.
- Confirm database and Redis services are healthy.
- Confirm `/health` returns success after deployment.
- Confirm logs do not print credential values.

Development checklist:

- Verify hot reload works after changing a file in `src/`.
- Verify dev Postgres and Redis volumes can be reset safely.

Staging checklist:

- Verify staging uses separate Supabase, database, and Redis resources.
- Verify debug logging is acceptable and does not leak secrets.
- Run a smoke test through login and one API request.

Production checklist:

- Verify branch protection on `main` is active before first production deploy.
- Verify image tag includes `production-<git-sha>`.
- Verify resource limits are appropriate for the host.
- Verify rollback instructions are known before deployment.
