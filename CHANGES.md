# Stream-API — Fixes Applied

## 🔴 Critical

### 1. SSE stream race condition fixed (`src/chat/chat.controller.ts`)
**Problem:** `stream.on('text')` was registered and then `await stream.finalMessage()` was called immediately. `finalMessage()` internally drains the stream, causing text events emitted after that point to be silently dropped — resulting in truncated AI responses.

**Fix:** Replaced the event listener pattern with `for await (const event of stream)` which processes every event in order. `finalMessage()` is now called only after the async iterator has fully completed the stream.

### 2. Dead dependencies removed (`package.json`)
**Problem:** `typeorm`, `passport`, `passport-jwt`, `@nestjs/passport`, `@nestjs/jwt`, and `bcryptjs` were installed but nothing in the codebase used them. `JwtAuthGuard` extended `AuthGuard('jwt')` from Passport but was never registered.

**Fix:** All dead packages removed. `JwtAuthGuard` replaced with an explanatory stub.

### 3. CORS default port fixed (`src/main.ts`, `src/config/env.validation.ts`)
**Problem:** Default CORS origin was `http://localhost:4200` (Angular's port). Next.js runs on `:3001` — the frontend would be CORS-blocked if `ALLOWED_ORIGINS` env var was not set.

**Fix:** Default changed to `http://localhost:3001`.

## 🟡 Significant

### 4. Atomic quota enforcement moved to Postgres (`src/database/schema.sql`, `src/common/guards/quota.guard.ts`, `src/chat/ai.service.ts`)
**Problem:** `QuotaGuard` read `tokens_used`, compared to `token_quota` in application code, then returned. Between the read and the actual AI call another concurrent request could pass the same check — together exceeding the quota.

**Fix:** `increment_tenant_tokens()` Postgres function rewritten to use `SELECT FOR UPDATE` (row lock) and check the quota atomically before incrementing. If quota would be exceeded, it raises `QUOTA_EXCEEDED`. `QuotaGuard` now only checks `is_active`. `AIService.logUsage()` catches the `QUOTA_EXCEEDED` exception from the RPC and rethrows it as HTTP 429.

### 5. BullMQ uses ConfigService (`src/app.module.ts`)
**Problem:** `BullModule.forRoot` read `process.env.REDIS_HOST/PORT` directly, bypassing the validated `EnvironmentVariables` schema and silently using defaults if vars were missing.

**Fix:** Changed to `BullModule.forRootAsync` with `ConfigService` injection.

### 6. System prompt added to AI calls (`src/chat/ai.service.ts`)
**Problem:** All Anthropic API calls had no `system` parameter — the model had no identity, constraints, or context.

**Fix:** Added a baseline system prompt to both `streamChatResponse` and `createCompletion`.
