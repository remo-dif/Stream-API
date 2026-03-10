import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import Redis from 'ioredis';

@Injectable()
export class UsageService {
  private redis: Redis;

  constructor(
    private supabaseService: SupabaseService,
    configService: ConfigService,
  ) {
    this.redis = new Redis(configService.get<string>('REDIS_URL') || 'redis://localhost:6379');
  }

  async getDashboard(tenantId: string, user: any) {
    const today = new Date().toISOString().split('T')[0];
    const todayTokens = parseInt((await this.redis.get(`usage:${tenantId}:${today}`)) || '0');

    // Get 30-day summary
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: summary } = await this.supabaseService
      .getAdminClient()
      .from('usage_logs')
      .select('total_tokens, input_tokens, output_tokens')
      .eq('tenant_id', tenantId)
      .gte('created_at', thirtyDaysAgo);

    // Calculate aggregates from fetched data
    const aggregated = (summary || []).reduce(
      (acc, log: any) => ({
        totalTokens: acc.totalTokens + (log.total_tokens || 0),
        inputTokens: acc.inputTokens + (log.input_tokens || 0),
        outputTokens: acc.outputTokens + (log.output_tokens || 0),
        requestCount: acc.requestCount + 1,
      }),
      { totalTokens: 0, inputTokens: 0, outputTokens: 0, requestCount: 0 },
    );

    return {
      quota: {
        total: 1000000, // Default quota - extend this from tenant profile
        used: aggregated.totalTokens,
        percentage: Math.round((aggregated.totalTokens / 1000000) * 100),
      },
      today: { tokens: todayTokens },
      last30Days: aggregated,
      dailyBreakdown: summary,
    };
  }

  async getLogs(tenantId: string, page: number = 1, limit: number = 50) {
    const offset = (page - 1) * limit;

    const { data: logs, error } = await this.supabaseService
      .getAdminClient()
      .from('usage_logs')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { count } = await this.supabaseService
      .getAdminClient()
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    if (error) throw error;

    return { logs: logs || [], page, limit, total: count || 0 };
  }
}
