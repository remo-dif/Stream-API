import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UsageService } from './usage.service';
import { SupabaseService } from '../supabase/supabase.service';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue(null),
  }));
});

import Redis from 'ioredis';

function makeSingleBuilder(result: { data?: any; error?: any }) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null }),
  };
}

function makeLogsBuilder(result: { data?: any; error?: any; count?: number | null }) {
  const resolved = {
    data: result.data ?? null,
    error: result.error ?? null,
    count: result.count ?? null,
  };
  const b: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
  };
  b.then = (res: any, rej: any) => Promise.resolve(resolved).then(res, rej);
  return b;
}

describe('UsageService', () => {
  let service: UsageService;
  let adminClient: any;
  let mockRedis: any;

  const TENANT = { token_quota: 1_000_000, tokens_used: 250_000, plan: 'starter' };
  const SUMMARY = [{
    total_tokens: 300_000,
    input_tokens: 200_000,
    output_tokens: 100_000,
    request_count: 42,
  }];

  beforeEach(async () => {
    adminClient = {
      from: jest.fn(),
      rpc: jest.fn().mockResolvedValue({ data: SUMMARY, error: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsageService,
        {
          provide: SupabaseService,
          useValue: { getAdminClient: jest.fn().mockReturnValue(adminClient) },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('redis://localhost:6379') },
        },
      ],
    }).compile();

    service = module.get<UsageService>(UsageService);
    mockRedis = (Redis as unknown as jest.Mock).mock.results[0]?.value;
  });

  // ── getDashboard ─────────────────────────────────────────────────────────────

  describe('getDashboard', () => {
    it('returns zeroed dashboard when tenantId is empty', async () => {
      const result = await service.getDashboard('');
      expect(result).toEqual({
        quota: { total: 0, used: 0, percentage: 0 },
        today: { tokens: 0 },
        last30Days: { totalTokens: 0, inputTokens: 0, outputTokens: 0, requestCount: 0 },
      });
    });

    it('returns correct quota percentage', async () => {
      adminClient.from.mockReturnValue(makeSingleBuilder({ data: TENANT }));

      const result = await service.getDashboard('tenant-1');
      expect(result.quota).toEqual({
        total: 1_000_000,
        used: 250_000,
        percentage: 25,
      });
    });

    it('returns last 30 days stats from RPC', async () => {
      adminClient.from.mockReturnValue(makeSingleBuilder({ data: TENANT }));

      const result = await service.getDashboard('tenant-1');
      expect(result.last30Days).toEqual({
        totalTokens: 300_000,
        inputTokens: 200_000,
        outputTokens: 100_000,
        requestCount: 42,
      });
    });

    it('returns today token count from Redis', async () => {
      adminClient.from.mockReturnValue(makeSingleBuilder({ data: TENANT }));
      mockRedis.get.mockResolvedValue('1234');

      const result = await service.getDashboard('tenant-1');
      expect(result.today.tokens).toBe(1234);
    });

    it('degrades today tokens to 0 when Redis is unavailable', async () => {
      adminClient.from.mockReturnValue(makeSingleBuilder({ data: TENANT }));
      mockRedis.get.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await service.getDashboard('tenant-1');
      expect(result.today.tokens).toBe(0);
    });

    it('caps quota percentage at 100%', async () => {
      adminClient.from.mockReturnValue(
        makeSingleBuilder({ data: { ...TENANT, tokens_used: 2_000_000 } }),
      );

      const result = await service.getDashboard('tenant-1');
      expect(result.quota.percentage).toBe(100);
    });

    it('returns 0 percentage when quota is 0', async () => {
      adminClient.from.mockReturnValue(
        makeSingleBuilder({ data: { ...TENANT, token_quota: 0 } }),
      );

      const result = await service.getDashboard('tenant-1');
      expect(result.quota.percentage).toBe(0);
    });

    it('returns zeroed last30Days when RPC returns no rows', async () => {
      adminClient.from.mockReturnValue(makeSingleBuilder({ data: TENANT }));
      adminClient.rpc.mockResolvedValue({ data: [], error: null });

      const result = await service.getDashboard('tenant-1');
      expect(result.last30Days).toEqual({
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        requestCount: 0,
      });
    });
  });

  // ── getLogs ──────────────────────────────────────────────────────────────────

  describe('getLogs', () => {
    it('returns empty result for empty tenantId', async () => {
      const result = await service.getLogs('', 1, 50);
      expect(result).toEqual({ logs: [], page: 1, limit: 50, total: 0 });
    });

    it('returns paginated logs with total count', async () => {
      const logs = [{ id: 'log-1' }, { id: 'log-2' }];
      adminClient.from.mockReturnValue(makeLogsBuilder({ data: logs, count: 42 }));

      const result = await service.getLogs('tenant-1', 1, 10);
      expect(result).toEqual({
        logs,
        page: 1,
        limit: 10,
        total: 42,
        totalPages: 5,
      });
    });

    it('caps limit at 100', async () => {
      adminClient.from.mockReturnValue(makeLogsBuilder({ data: [], count: 0 }));
      const result = await service.getLogs('tenant-1', 1, 999);
      expect(result.limit).toBe(100);
    });

    it('calculates correct offset for page 3', async () => {
      const builder = makeLogsBuilder({ data: [], count: 0 });
      adminClient.from.mockReturnValue(builder);

      await service.getLogs('tenant-1', 3, 10);
      expect(builder.range).toHaveBeenCalledWith(20, 29);
    });

    it('throws on database error', async () => {
      adminClient.from.mockReturnValue(makeLogsBuilder({ error: { message: 'Query failed' } }));
      await expect(service.getLogs('tenant-1', 1, 50)).rejects.toMatchObject({
        message: 'Query failed',
      });
    });
  });
});
