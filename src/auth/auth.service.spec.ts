import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SupabaseService } from '../supabase/supabase.service';

const MOCK_USER = { id: 'user-123', email: 'test@example.com' };
const MOCK_SESSION = { access_token: 'access', refresh_token: 'refresh' };
const ACTIVE_PROFILE = {
  id: MOCK_USER.id,
  email: MOCK_USER.email,
  role: 'user',
  tenant_id: 'tenant-1',
  is_active: true,
};

function makeMutationBuilder(result: { data: any; error: any }) {
  const builder: any = {
    upsert: jest.fn().mockReturnThis(),
  };
  builder.then = (resolve: any, reject: any) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function makeSelectBuilder(result: { data: any; error: any }) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let anonClient: any;
  let adminClient: any;

  beforeEach(async () => {
    anonClient = {
      auth: {
        signUp: jest.fn(),
        signInWithPassword: jest.fn(),
        refreshSession: jest.fn(),
      },
    };

    adminClient = {
      auth: {
        getUser: jest.fn(),
        admin: {
          deleteUser: jest.fn(),
          signOut: jest.fn(),
        },
      },
      from: jest
        .fn()
        .mockReturnValue(makeMutationBuilder({ data: null, error: null })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: SupabaseService,
          useValue: {
            getClient: jest.fn().mockReturnValue(anonClient),
            getAdminClient: jest.fn().mockReturnValue(adminClient),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('signUp', () => {
    const dto = {
      email: 'test@example.com',
      password: 'secret123',
      tenantId: 'tenant-1',
    };

    it('returns user and session on success', async () => {
      anonClient.auth.signUp.mockResolvedValue({
        data: { user: MOCK_USER, session: MOCK_SESSION },
        error: null,
      });

      await expect(service.signUp(dto)).resolves.toEqual({
        user: { id: MOCK_USER.id, email: MOCK_USER.email },
        session: MOCK_SESSION,
      });

      expect(adminClient.from).toHaveBeenCalledWith('profiles');
      expect(adminClient.from.mock.results[0]?.value.upsert).toHaveBeenCalledWith(
        {
          id: MOCK_USER.id,
          tenant_id: dto.tenantId,
          email: dto.email,
          role: 'user',
          is_active: true,
        },
        { onConflict: 'id' },
      );
    });

    it('throws ConflictException when email already registered', async () => {
      anonClient.auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'User already registered' },
      });

      await expect(service.signUp(dto)).rejects.toThrow(ConflictException);
    });

    it('throws InternalServerErrorException when auth returns no user', async () => {
      anonClient.auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: null,
      });

      await expect(service.signUp(dto)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('cleans up orphaned users when profile creation fails', async () => {
      anonClient.auth.signUp.mockResolvedValue({
        data: { user: MOCK_USER, session: MOCK_SESSION },
        error: null,
      });
      adminClient.from.mockReturnValue(
        makeMutationBuilder({ data: null, error: { message: 'DB error' } }),
      );
      adminClient.auth.admin.deleteUser.mockResolvedValue({ error: null });

      await expect(service.signUp(dto)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(adminClient.auth.admin.deleteUser).toHaveBeenCalledWith(
        MOCK_USER.id,
      );
    });
  });

  describe('signIn', () => {
    it('returns session data for active profiles with tenants', async () => {
      anonClient.auth.signInWithPassword.mockResolvedValue({
        data: { user: MOCK_USER, session: MOCK_SESSION },
        error: null,
      });
      adminClient.from.mockReturnValue(
        makeSelectBuilder({ data: ACTIVE_PROFILE, error: null }),
      );

      await expect(
        service.signIn('test@example.com', 'secret123'),
      ).resolves.toEqual({
        user: MOCK_USER,
        session: MOCK_SESSION,
      });
    });

    it('throws UnauthorizedException on invalid credentials', async () => {
      anonClient.auth.signInWithPassword.mockResolvedValue({
        data: null,
        error: { message: 'Invalid login credentials' },
      });

      await expect(service.signIn('test@example.com', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws ForbiddenException when the user is deactivated', async () => {
      anonClient.auth.signInWithPassword.mockResolvedValue({
        data: { user: MOCK_USER, session: MOCK_SESSION },
        error: null,
      });
      adminClient.from.mockReturnValue(
        makeSelectBuilder({
          data: { ...ACTIVE_PROFILE, is_active: false },
          error: null,
        }),
      );

      await expect(service.signIn('test@example.com', 'secret123')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when the user has no tenant assignment', async () => {
      anonClient.auth.signInWithPassword.mockResolvedValue({
        data: { user: MOCK_USER, session: MOCK_SESSION },
        error: null,
      });
      adminClient.from.mockReturnValue(
        makeSelectBuilder({
          data: { ...ACTIVE_PROFILE, tenant_id: null },
          error: null,
        }),
      );

      await expect(service.signIn('test@example.com', 'secret123')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('signOut', () => {
    it('revokes the session by user id', async () => {
      adminClient.auth.getUser.mockResolvedValue({
        data: { user: MOCK_USER },
        error: null,
      });
      adminClient.auth.admin.signOut.mockResolvedValue({ error: null });

      await expect(service.signOut('valid-token')).resolves.toEqual({
        message: 'Signed out successfully',
      });
      expect(adminClient.auth.admin.signOut).toHaveBeenCalledWith(
        MOCK_USER.id,
        'local',
      );
    });

    it('throws when the access token is invalid', async () => {
      adminClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid token' },
      });

      await expect(service.signOut('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('getUser', () => {
    it('returns the validated profile', async () => {
      adminClient.from.mockReturnValue(
        makeSelectBuilder({ data: ACTIVE_PROFILE, error: null }),
      );

      await expect(service.getUser(MOCK_USER.id)).resolves.toEqual(
        ACTIVE_PROFILE,
      );
    });
  });

  describe('refreshSession', () => {
    it('returns refreshed session data for active users', async () => {
      anonClient.auth.refreshSession.mockResolvedValue({
        data: { user: MOCK_USER, session: MOCK_SESSION },
        error: null,
      });
      adminClient.from.mockReturnValue(
        makeSelectBuilder({ data: ACTIVE_PROFILE, error: null }),
      );

      await expect(service.refreshSession('refresh-token')).resolves.toEqual({
        user: MOCK_USER,
        session: MOCK_SESSION,
      });
      expect(anonClient.auth.refreshSession).toHaveBeenCalledWith({
        refresh_token: 'refresh-token',
      });
    });

    it('throws UnauthorizedException when refresh token is invalid', async () => {
      anonClient.auth.refreshSession.mockResolvedValue({
        data: null,
        error: { message: 'Token expired' },
      });

      await expect(service.refreshSession('expired')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
