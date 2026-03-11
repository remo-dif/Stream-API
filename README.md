# AI SaaS Platform (NestJS + TypeScript)

Production-grade multi-tenant AI chat platform built with NestJS, TypeScript, and streaming AI responses.

## Architecture

```
[Frontend] ──SSE──▶ [Nginx] ──▶ [NestJS API] ──▶ [PostgreSQL]
                                      │
                                 [Supabase Auth]
                                      │
                                 [Redis Cache]
                                      │
                                [BullMQ Worker] ──▶ [Anthropic API]
```

## Tech Stack

- **Backend:** NestJS 10 + TypeScript 5
- **ORM:** TypeORM with PostgreSQL entities
- **Authentication:** Supabase with JWT verification
- **Database:** PostgreSQL (via Supabase)
- **Queue:** BullMQ with Redis
- **API Docs:** Swagger/OpenAPI
- **Validation:** class-validator + class-transformer
- **Streaming:** Server-Sent Events (SSE)
- **AI Provider:** Anthropic API

## Project Structure

```
src/
├── main.ts                      # Application entry point
├── app.module.ts                # Root module
├── auth/                        # Supabase authentication
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── guards/
│   │   └── supabase-auth.guard.ts
│   └── dto/
│       └── auth.dto.ts
├── chat/                        # AI conversations & streaming
│   ├── chat.controller.ts
│   ├── chat.service.ts
│   ├── ai.service.ts            # Anthropic integration
│   └── dto/
│       └── chat.dto.ts
├── admin/                       # User management (RBAC)
│   ├── admin.controller.ts
│   ├── admin.service.ts
│   └── admin.module.ts
├── usage/                       # Token usage tracking
│   ├── usage.controller.ts
│   ├── usage.service.ts
│   └── usage.module.ts
├── tenants/                     # Multi-tenancy
│   ├── tenants.controller.ts
│   ├── tenants.service.ts
│   ├── tenants.module.ts
│   └── dto/
│       └── create-tenant.dto.ts
├── jobs/                        # Async job submission
│   ├── jobs.controller.ts
│   ├── jobs.service.ts
│   ├── jobs.module.ts
│   └── dto/
│       └── submit-job.dto.ts
├── queue/                       # BullMQ job processing
│   ├── ai-job.processor.ts      # Job processor
│   ├── queue.module.ts
│   └── queue.service.ts
├── supabase/                    # Supabase integration
│   ├── supabase.module.ts
│   └── supabase.service.ts
├── common/
│   ├── guards/                  # Auth, Quota, Roles guards
│   ├── decorators/              # @AuthUser, @Roles, @TenantId
│   ├── filters/                 # Error handling
│   └── interceptors/
├── config/
│   └── env.validation.ts        # Environment validation
└── database/
    ├── entities/                # TypeORM entities
    │   ├── user.entity.ts
    │   ├── tenant.entity.ts
    │   ├── conversation.entity.ts
    │   └── usage-log.entity.ts
    └── schema.sql               # PostgreSQL schema
```

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Fill in:
#   - SUPABASE_URL, SUPABASE_KEY
#   - ANTHROPIC_API_KEY
#   - REDIS_URL, DATABASE_URL
#   - JWT_SECRET (for internal signing)

# Start with Docker Compose
cd infrastructure/docker
docker-compose up -d

# Run migrations
npm run migrate

# Development mode
npm run start:dev

# Production build
npm run build
npm run start:prod
```

## API Documentation

Once running, visit: http://localhost:3000/api/docs

## Key Features

| Feature | Implementation |
|---------|---------------|
| Type Safety | Full TypeScript with strict mode |
| Dependency Injection | NestJS IoC container |
| Validation | class-validator DTOs on all routes |
| Authentication | Supabase JWT guard with @SupabaseAuthGuard |
| RBAC | @Roles decorator + RolesGuard |
| Multi-Tenancy | tenant_id isolation via TypeORM entities |
| AI Streaming | Anthropic SDK → SSE via NestJS |
| Token Tracking | TypeORM + Redis counters in UsageService |
| Quota Management | QuotaGuard enforces usage limits |
| Background Jobs | BullMQ with AI job processor |
| Job Monitoring | JobsService with status tracking |
| Admin Tools | AdminService for user management |
| API Documentation | Swagger with @ApiTags, @ApiOperation |
| Database | PostgreSQL with TypeORM entity mapping |
| Queue System | Redis + BullMQ for async processing |

## Environment Variables

See `.env.example` for all required variables.

## Deployment

Docker Compose is included for local/staging. For production AWS:
- ECS Fargate containers
- RDS PostgreSQL
- ElastiCache Redis
- Application Load Balancer

## Testing

```bash
npm run test
npm run test:cov
```
