# Stream API

Multi-tenant AI SaaS backend built with NestJS, Supabase, Redis, and BullMQ.

This API handles:
- Supabase auth and profile lookup
- tenant-aware conversations and messages
- SSE chat streaming
- usage and quota tracking
- async AI jobs
- admin and tenant management

## Current Architecture

```text
Next.js frontend
  -> NestJS API
    -> Supabase Auth + Postgres
    -> Redis / BullMQ
    -> OpenAI (default)
    -> Anthropic (optional provider path)
```

## Tech Stack

- NestJS 11
- TypeScript 5
- Supabase (`auth` + Postgres access)
- BullMQ + Redis
- Swagger
- class-validator / class-transformer
- OpenAI SDK
- Anthropic SDK

## Notes About Persistence

The app includes TypeORM entities for schema modeling, but the live application path is Supabase-first. Most reads and writes happen through the Supabase client rather than `TypeOrmModule`.

## Main Modules

```text
src/
  app.module.ts
  main.ts
  auth/         signup, signin, signout, refresh, auth guard
  chat/         conversations, messages, streaming, LLM integration
  usage/        dashboard and usage aggregation
  jobs/         async job submission and listing
  queue/        BullMQ worker + processor
  tenants/      current tenant and tenant creation
  admin/        role and user management
  supabase/     Supabase client wiring
  config/       environment validation
  database/     SQL schema and entities
```

## LLM Providers

The backend now supports provider selection through config.

Supported provider modes:
- `openai` as the default
- `anthropic` as an optional provider path

Relevant environment variables:
- `LLM_PROVIDER`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`

Model overrides are inferred by model prefix:
- `gpt-*` / `o*` -> OpenAI
- `claude-*` -> Anthropic

## Environment

Copy `.env.example` to `.env` and fill in the required values.

Important variables:

```env
NODE_ENV=production
PORT=3000
ALLOWED_ORIGINS=http://localhost:3001

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379

LLM_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
```

## Local Development

Install dependencies:

```bash
npm install
```

Start Redis with Docker:

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d redis
```

Run the API:

```bash
npm run start:dev
```

Build for production:

```bash
npm run build
npm run start:prod
```

Swagger docs:

```text
http://localhost:3000/api/docs
```

## Frontend Pairing

This backend is designed to run with the `Stream-UI` Next.js app.

Typical local ports:
- API: `http://localhost:3000`
- Frontend: `http://localhost:3001`

## Database Expectations

The live app expects these core public tables:
- `profiles`
- `tenants`
- `conversations`
- `messages`
- `usage_logs`
- `async_jobs`

The checked-in SQL defaults now align new conversations to:
- `gpt-4.1-mini`

If your live Supabase project was created before that change, apply the corresponding migration so DB defaults match the code.

## Background Jobs

BullMQ is used for tasks that should not block the request/response cycle.

Current job types:
- `summarize`
- `analyze`
- `translate`

Worker entry:

```bash
npm run worker
```

## Testing

Run the full test suite:

```bash
npm test -- --watch=false --runInBand
```

Coverage:

```bash
npm run test:cov
```

## Jenkins CI

This repo includes a `Jenkinsfile` for GitHub-driven CI.

The Jenkins agent should have:
- Node.js 20+
- npm
- Docker Engine with Docker Compose v2
- access to the Docker socket if Jenkins runs in a container

Recommended Jenkins plugins:
- Git
- GitHub
- Pipeline
- AnsiColor
- Workspace Cleanup

Create the job in Jenkins:

```text
New Item -> Pipeline -> Pipeline script from SCM
SCM: Git
Repository URL: https://github.com/remo-dif/Stream-API.git
Script Path: Jenkinsfile
```

Enable GitHub webhooks:

```text
GitHub repo -> Settings -> Webhooks -> Add webhook
Payload URL: https://your-jenkins-domain/github-webhook/
Content type: application/json
Events: Just the push event
```

The pipeline runs:
- dependency install
- unit tests
- production build
- API Docker image build
- Docker Compose config smoke check without printing environment secrets

## Current Status

Verified recently:
- backend build passes
- backend test suite passes
- Supabase auth/profile/tenant flow is wired
- conversation and usage flows are working
- OpenAI is the default provider path in code

Remaining external dependency:
- live generation still depends on whichever provider key you configure and fund
