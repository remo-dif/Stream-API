import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class UsageService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getDashboard(tenantId: string) {
    if (!tenantId) {
      return {
        quota: { total: 0, used: 0, percentage: 0 },
        today: { tokens: 0 },
        last30Days: { totalTokens: 0, inputTokens: 0, outputTokens: 0, requestCount: 0 },
      };
    }

    // Fetch quota from the tenant row — never hardcode 1M
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [tenantResult, summaryResult, todayResult] = await Promise.all([
      this.supabaseService
        .getAdminClient()
        .from('tenants')
        .select('token_quota, tokens_used, plan')
        .eq('id', tenantId)
        .single(),

      // DB-side aggregation via RPC — avoids loading thousands of rows into Node memory
      this.supabaseService.getAdminClient().rpc('get_usage_summary', {
        p_tenant_id: tenantId,
        p_since: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      }),

      this.supabaseService.getAdminClient().rpc('get_usage_summary', {
        p_tenant_id: tenantId,
        p_since: todayStart.toISOString(),
      }),
    ]);

    const tenant = tenantResult.data;
    const summary = summaryResult.data?.[0] ?? {
      total_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
      request_count: 0,
    };
    const todaySummary = todayResult.data?.[0] ?? {
      total_tokens: 0,
    };

    const quota = tenant?.token_quota ?? 0;
    const used = tenant?.tokens_used ?? 0;

    return {
      plan: tenant?.plan,
      quota: {
        total: quota,
        used,
        percentage: quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0,
      },
      today: { tokens: Number(todaySummary.total_tokens) },
      last30Days: {
        totalTokens: Number(summary.total_tokens),
        inputTokens: Number(summary.input_tokens),
        outputTokens: Number(summary.output_tokens),
        requestCount: Number(summary.request_count),
      },
    };
  }

  async getLogs(tenantId: string, page: number = 1, limit: number = 50) {
    if (!tenantId) return { logs: [], page, limit, total: 0 };

    const safeLimit = Math.min(limit, 100);
    const offset = (page - 1) * safeLimit;

    // Single query with count — eliminates the duplicate DB round-trip
    const { data: logs, error, count } = await this.supabaseService
      .getAdminClient()
      .from('usage_logs')
      .select('id, model, input_tokens, output_tokens, total_tokens, created_at', {
        count: 'exact',
      })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + safeLimit - 1);

    if (error) throw error;

    return {
      logs: logs ?? [],
      page,
      limit: safeLimit,
      total: count ?? 0,
      totalPages: count ? Math.ceil(count / safeLimit) : 0,
    };
  }

  async getDailyUsage(tenantId: string, days: number = 30) {
    if (!tenantId) return [];

    const safeDays = Math.min(Math.max(days, 1), 90);
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (safeDays - 1));

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('usage_logs')
      .select('created_at, total_tokens')
      .eq('tenant_id', tenantId)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: true });

    if (error) throw error;

    const byDay = new Map<string, { tokens: number; requests: number }>();

    for (let i = 0; i < safeDays; i += 1) {
      const day = new Date(since);
      day.setDate(since.getDate() + i);
      const key = day.toISOString().split('T')[0];
      byDay.set(key, { tokens: 0, requests: 0 });
    }

    for (const row of data ?? []) {
      const key = new Date(row.created_at).toISOString().split('T')[0];
      const current = byDay.get(key);
      if (!current) continue;
      current.tokens += Number(row.total_tokens ?? 0);
      current.requests += 1;
    }

    return Array.from(byDay.entries()).map(([date, value]) => ({
      date,
      tokens: value.tokens,
      requests: value.requests,
    }));
  }
}
