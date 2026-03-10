import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { UsageModule } from './usage/usage.module';
import { AdminModule } from './admin/admin.module';
import { JobsModule } from './jobs/jobs.module';
import { TenantsModule } from './tenants/tenants.module';
import { QueueModule } from './queue/queue.module';
import { validate } from './config/env.validation';

@Module({
  imports: [
    // Configuration — validate required env vars at startup, fail fast if missing
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate,
    }),

    // Rate limiting — 100 req/min short window, 1000 req/hour long window
    // ThrottlerGuard is applied globally via APP_GUARD below.
    // TODO for multi-instance: swap default in-memory store for
    // ThrottlerStorageRedis (@nestjs/throttler + ioredis) so limits are shared.
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 60_000,   // 1 minute
        limit: 100,
      },
      {
        name: 'long',
        ttl: 3_600_000, // 1 hour
        limit: 1_000,
      },
    ]),

    // BullMQ — reads REDIS_HOST / REDIS_PORT from validated env
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      },
    }),

    // Feature modules
    SupabaseModule,
    AuthModule,
    ChatModule,
    UsageModule,
    AdminModule,
    JobsModule,
    TenantsModule,
    QueueModule,
  ],
  providers: [
    // Apply ThrottlerGuard to every route globally
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
