import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { QuotaGuard } from './quota.guard';
import { SupabaseService } from '../../supabase/supabase.service';

function makeTenantBuilder(result: { data: any; error: any }) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
  };
}

function makeContext(user?: any): { ctx: ExecutionContext; request: any } {
  const request: any = { user };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

describe('QuotaGuard', () => {
  let guard: QuotaGuard;
  let adminClient: any;

  const activeTenant = { token_quota: 1_000_000, tokens_used: 500_000, is_active: true };

  beforeEach(async () => {
    adminClient = {
      from: jest.fn().mockReturnValue(makeTenantBuilder({ data: activeTenant, error: null })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuotaGuard,
        {
          provide: SupabaseService,
          useValue: { getAdminClient: jest.fn().mockReturnValue(adminClient) },
        },
      ],
    }).compile();

    guard = module.get<QuotaGuard>(QuotaGuard);
  });

  it('throws UnauthorizedException when user has no id (guard ran before SupabaseAuthGuard)', async () => {
    const { ctx } = makeContext({ tenantId: 'tenant-1' }); // no id
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when user has no tenantId', async () => {
    const { ctx } = makeContext({ id: 'user-1' }); // no tenantId
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws 503 when database fetch fails', async () => {
    adminClient.from.mockReturnValue(
      makeTenantBuilder({ data: null, error: { message: 'Connection refused' } }),
    );
    const { ctx } = makeContext({ id: 'user-1', tenantId: 'tenant-1' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      expect.objectContaining({ status: HttpStatus.SERVICE_UNAVAILABLE }),
    );
  });

  it('throws 403 when tenant row not found', async () => {
    adminClient.from.mockReturnValue(makeTenantBuilder({ data: null, error: null }));
    const { ctx } = makeContext({ id: 'user-1', tenantId: 'tenant-1' });

    await expect(guard.canActivate(ctx)).rejects.toThrow(
      expect.objectContaining({ status: HttpStatus.FORBIDDEN }),
    );
  });

  it('throws 403 with TENANT_SUSPENDED code when tenant is inactive', async () => {
    adminClient.from.mockReturnValue(
      makeTenantBuilder({ data: { ...activeTenant, is_active: false }, error: null }),
    );
    const { ctx } = makeContext({ id: 'user-1', tenantId: 'tenant-1' });

    try {
      await guard.canActivate(ctx);
      fail('Expected exception');
    } catch (e: any) {
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(HttpStatus.FORBIDDEN);
      expect(e.getResponse()).toMatchObject({ code: 'TENANT_SUSPENDED' });
    }
  });

  it('throws 429 with QUOTA_EXCEEDED code when quota is exhausted', async () => {
    adminClient.from.mockReturnValue(
      makeTenantBuilder({
        data: { token_quota: 1_000, tokens_used: 1_000, is_active: true },
        error: null,
      }),
    );
    const { ctx } = makeContext({ id: 'user-1', tenantId: 'tenant-1' });

    try {
      await guard.canActivate(ctx);
      fail('Expected exception');
    } catch (e: any) {
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(e.getResponse()).toMatchObject({ code: 'QUOTA_EXCEEDED' });
    }
  });

  it('allows requests when tokens_used is below quota', async () => {
    const { ctx } = makeContext({ id: 'user-1', tenantId: 'tenant-1' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('attaches tenant to request.tenant on success', async () => {
    const { ctx, request } = makeContext({ id: 'user-1', tenantId: 'tenant-1' });
    await guard.canActivate(ctx);
    expect(request.tenant).toEqual(activeTenant);
  });

  it('allows requests when token_quota is 0 (unlimited)', async () => {
    adminClient.from.mockReturnValue(
      makeTenantBuilder({
        data: { token_quota: 0, tokens_used: 999_999, is_active: true },
        error: null,
      }),
    );
    const { ctx } = makeContext({ id: 'user-1', tenantId: 'tenant-1' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });
});
