import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { SupabaseService } from '../../supabase/supabase.service';

const MOCK_USER = { id: 'user-123', email: 'test@example.com' };
const ACTIVE_PROFILE = {
  role: 'user',
  tenant_id: 'tenant-123',
  is_active: true,
};

function makeProfileBuilder(result: { data: any; error: any }) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
  };
}

function makeContext(authHeader?: string): {
  ctx: ExecutionContext;
  request: any;
} {
  const request: any = {
    headers: authHeader ? { authorization: authHeader } : {},
    user: undefined,
  };

  const ctx = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { ctx, request };
}

describe('SupabaseAuthGuard', () => {
  let guard: SupabaseAuthGuard;
  let reflector: jest.Mocked<Reflector>;
  let adminClient: any;

  beforeEach(async () => {
    adminClient = {
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: MOCK_USER },
          error: null,
        }),
      },
      from: jest
        .fn()
        .mockReturnValue(makeProfileBuilder({ data: ACTIVE_PROFILE, error: null })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupabaseAuthGuard,
        {
          provide: SupabaseService,
          useValue: { getAdminClient: jest.fn().mockReturnValue(adminClient) },
        },
        {
          provide: Reflector,
          useValue: { getAllAndOverride: jest.fn().mockReturnValue(false) },
        },
      ],
    }).compile();

    guard = module.get<SupabaseAuthGuard>(SupabaseAuthGuard);
    reflector = module.get(Reflector);
  });

  it('allows public routes without checking the token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const { ctx } = makeContext();

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(adminClient.auth.getUser).not.toHaveBeenCalled();
  });

  it('throws when the Authorization header is absent', async () => {
    const { ctx } = makeContext();
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws when Supabase rejects the token', async () => {
    adminClient.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid JWT' },
    });

    const { ctx } = makeContext('Bearer bad-token');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws when the profile row is missing', async () => {
    adminClient.from.mockReturnValue(
      makeProfileBuilder({ data: null, error: { message: 'missing' } }),
    );

    const { ctx } = makeContext('Bearer valid-token');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws ForbiddenException for deactivated accounts', async () => {
    adminClient.from.mockReturnValue(
      makeProfileBuilder({
        data: { ...ACTIVE_PROFILE, is_active: false },
        error: null,
      }),
    );

    const { ctx } = makeContext('Bearer valid-token');
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when the user is not assigned to a tenant', async () => {
    adminClient.from.mockReturnValue(
      makeProfileBuilder({
        data: { ...ACTIVE_PROFILE, tenant_id: null },
        error: null,
      }),
    );

    const { ctx } = makeContext('Bearer valid-token');
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('enriches request.user with role and tenantId', async () => {
    const { ctx, request } = makeContext('Bearer valid-token');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toMatchObject({
      id: MOCK_USER.id,
      email: MOCK_USER.email,
      role: 'user',
      tenantId: 'tenant-123',
    });
  });
});
