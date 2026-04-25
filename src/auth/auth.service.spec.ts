import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SupabaseService } from '../supabase/supabase.service';

const MOCK_USER = { id: 'user-123', email: 'test@example.com' };
const MOCK_SESSION = { access_token: 'access', refresh_token: 'refresh' };

function makeInsertBuilder(result: { data: any; error: any }) {
  const b: any = {
    insert: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
  };
  b.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
  return b;
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
      from: jest.fn().mockReturnValue(makeInsertBuilder({ data: null, error: null })),
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

  // ── signUp ──────────────────────────────────────────────────────────────────

  describe('signUp', () => {
    const dto = { email: 'test@example.com', password: 'secret123', tenantId: 'tenant-1' };

    it('returns user and session on success', async () => {
      anonClient.auth.signUp.mockResolvedValue({
        data: { user: MOCK_USER, session: MOCK_SESSION },
        error: null,
      });

      const result = await service.signUp(dto);
      expect(result).toEqual({ user: { id: 'user-123', email: 'test@example.com' }, session: MOCK_SESSION });
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

    it('throws UnauthorizedException on other auth errors', async () => {
      anonClient.auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Something went wrong' },
      });

      await expect(service.signUp(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('throws InternalServerErrorException when auth returns no user', async () => {
      anonClient.auth.signUp.mockResolvedValue({
        data: { user: null, session: null },
        error: null,
      });

      await expect(service.signUp(dto)).rejects.toThrow(InternalServerErrorException);
    });

    it('cleans up orphaned auth user when profile insert fails', async () => {
      anonClient.auth.signUp.mockResolvedValue({
        data: { user: MOCK_USER, session: MOCK_SESSION },
        error: null,
      });
      adminClient.from.mockReturnValue(
        makeInsertBuilder({ data: null, error: { message: 'FK violation' } }),
      );
      adminClient.auth.admin.deleteUser.mockResolvedValue({ error: null });

      await expect(service.signUp(dto)).rejects.toThrow(InternalServerErrorException);
      expect(adminClient.auth.admin.deleteUser).toHaveBeenCalledWith(MOCK_USER.id);
    });

    it('still throws InternalServerErrorException even if cleanup fails', async () => {
      anonClient.auth.signUp.mockResolvedValue({
        data: { user: MOCK_USER, session: MOCK_SESSION },
        error: null,
      });
      adminClient.from.mockReturnValue(
        makeInsertBuilder({ data: null, error: { message: 'DB error' } }),
      );
      adminClient.auth.admin.deleteUser.mockResolvedValue({ error: { message: 'Already gone' } });

      await expect(service.signUp(dto)).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ── signIn ──────────────────────────────────────────────────────────────────

  describe('signIn', () => {
    it('returns session data on success', async () => {
      const mockData = { user: MOCK_USER, session: MOCK_SESSION };
      anonClient.auth.signInWithPassword.mockResolvedValue({ data: mockData, error: null });

      const result = await service.signIn('test@example.com', 'secret123');
      expect(result).toEqual(mockData);
      expect(anonClient.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'secret123',
      });
    });

    it('throws UnauthorizedException on invalid credentials', async () => {
      anonClient.auth.signInWithPassword.mockResolvedValue({
        data: null,
        error: { message: 'Invalid login credentials' },
      });

      await expect(service.signIn('test@example.com', 'wrong')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── signOut ─────────────────────────────────────────────────────────────────

  describe('signOut', () => {
    it('returns success message and revokes session by user id', async () => {
      adminClient.auth.getUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
      adminClient.auth.admin.signOut.mockResolvedValue({ error: null });

      const result = await service.signOut('valid-token');
      expect(result).toEqual({ message: 'Signed out successfully' });
      expect(adminClient.auth.admin.signOut).toHaveBeenCalledWith(MOCK_USER.id, 'local');
    });

    it('throws UnauthorizedException when token is invalid', async () => {
      adminClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid token' },
      });

      await expect(service.signOut('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws InternalServerErrorException when signOut API call fails', async () => {
      adminClient.auth.getUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
      adminClient.auth.admin.signOut.mockResolvedValue({ error: { message: 'Server error' } });

      await expect(service.signOut('valid-token')).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ── getUser ─────────────────────────────────────────────────────────────────

  describe('getUser', () => {
    it('returns the current user profile by id', async () => {
      const profile = { id: MOCK_USER.id, email: MOCK_USER.email, tenant_id: 'tenant-1' };
      adminClient.from.mockReturnValue(makeSelectBuilder({ data: profile, error: null }));

      const result = await service.getUser(MOCK_USER.id);
      expect(result).toEqual(profile);
      expect(adminClient.from).toHaveBeenCalledWith('profiles');
    });

    it('throws UnauthorizedException on error', async () => {
      adminClient.from.mockReturnValue(
        makeSelectBuilder({ data: null, error: { message: 'Row not found' } }),
      );

      await expect(service.getUser(MOCK_USER.id)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── refreshSession ───────────────────────────────────────────────────────────

  describe('refreshSession', () => {
    it('returns refreshed session data', async () => {
      const mockData = { session: MOCK_SESSION, user: MOCK_USER };
      anonClient.auth.refreshSession.mockResolvedValue({ data: mockData, error: null });

      const result = await service.refreshSession('refresh-token');
      expect(result).toEqual(mockData);
      expect(anonClient.auth.refreshSession).toHaveBeenCalledWith({ refresh_token: 'refresh-token' });
    });

    it('throws UnauthorizedException when refresh token is expired', async () => {
      anonClient.auth.refreshSession.mockResolvedValue({
        data: null,
        error: { message: 'Token expired' },
      });

      await expect(service.refreshSession('stale-token')).rejects.toThrow(UnauthorizedException);
    });
  });
});
