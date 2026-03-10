# AI SaaS Platform (NestJS + TypeScript)

Production-grade multi-tenant AI chat platform built with NestJS, TypeScript, and streaming AI responses.

## Architecture

```
[Angular Frontend] ──SSE──▶ [Nginx] ──▶ [NestJS API] ──▶ [PostgreSQL]
                                              │
                                         [Redis Cache]
                                              │
                                        [BullMQ Worker] ──▶ [Anthropic API]
```

## Tech Stack

- **Backend:** NestJS 10 + TypeScript 5
- **ORM:** TypeORM with PostgreSQL entities
- **Authentication:** Passport JWT + bcryptjs
- **Queue:** BullMQ with Redis
- **API Docs:** Swagger/OpenAPI
- **Validation:** class-validator + class-transformer
- **Streaming:** Server-Sent Events (SSE)

## Project Structure

```
src/
├── main.ts                      # Application entry point
├── app.module.ts                # Root module
├── auth/                        # JWT authentication
│   ├── auth.controller.ts
│   ├── auth.service.ts
│   ├── jwt.strategy.ts
│   └── dto/
├── chat/                        # AI conversations & streaming
│   ├── chat.controller.ts
│   ├── chat.service.ts
│   ├── ai.service.ts            # Anthropic integration
│   └── dto/
├── usage/                       # Token usage dashboard
├── admin/                       # User management (RBAC)
├── jobs/                        # Async job submission
├── tenants/                     # Multi-tenancy
├── queue/                       # BullMQ worker processor
├── common/
│   ├── guards/                  # JWT, Roles, Quota guards
│   ├── decorators/              # @CurrentUser, @Roles, @TenantId
│   └── filters/                 # Error handling
└── database/
    ├── entities/                # TypeORM entities
    └── schema.sql               # PostgreSQL schema
```

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, JWT_SECRET, etc.

# Start with Docker Compose
cd infrastructure/docker
docker-compose up -d

# Run migrations
docker-compose exec postgres psql -U postgres -d ai_saas -f /schema.sql

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
| RBAC | @Roles decorator + RolesGuard |
| Multi-Tenancy | tenant_id isolation via TypeORM |
| AI Streaming | Anthropic SDK → SSE via NestJS |
| Token Tracking | TypeORM + Redis counters |
| Retry Logic | Exponential backoff (3 attempts) |
| Rate Limiting | @nestjs/throttler + Redis |
| Background Jobs | BullMQ with @Processor decorator |
| API Docs | Swagger with @ApiTags, @ApiOperation |
| Guards | SupabaseAuthGuard, RolesGuard, QuotaGuard |

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
