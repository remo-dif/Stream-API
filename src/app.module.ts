import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './auth/auth.module';
import { SupabaseAuthGuard } from './auth/guards/supabase-auth.guard';
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
    // TODO for multi-instance: swap default in-memory store for
    // ThrottlerStorageRedis (@nestjs/throttler + ioredis) so limits are shared.
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 60_000,     limit: 100   },
      { name: 'long',  ttl: 3_600_000,  limit: 1_000 },
    ]),

    // FIX: BullMQ now uses ConfigService so it respects the validated env schema
    // instead of reading process.env directly and silently using defaults.
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
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
    // Apply ThrottlerGuard globally
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Apply SupabaseAuthGuard globally — routes that should be public must use @Public()
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
  ],
})
export class AppModule {}
