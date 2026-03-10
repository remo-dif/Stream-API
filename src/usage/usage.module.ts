import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';

@Module({
  imports: [SupabaseModule],
  controllers: [UsageController],
  providers: [UsageService],
})
export class UsageModule {}
