import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { UsageModule } from './usage/usage.module';
import { AdminModule } from './admin/admin.module';
import { JobsModule } from './jobs/jobs.module';
import { TenantsModule } from './tenants/tenants.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),


    // Redis rate limiting
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 60000, // 1 minute
        limit: 100,
      },
      {
        name: 'long',
        ttl: 3600000, // 1 hour
        limit: 1000,
      },
    ]),

    // BullMQ for background jobs
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
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
})
export class AppModule {}
