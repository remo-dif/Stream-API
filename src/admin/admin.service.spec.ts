import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService, UserRole } from './admin.service';
import { SupabaseService } from '../supabase/supabase.service';

function makeBuilder(result: { data?: any; error?: any } = {}) {
  const resolved = { data: result.data ?? null, error: result.error ?? null };
  const b: any = {
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resolved),
  };
  b.then = (res: any, rej: any) => Promise.resolve(resolved).then(res, rej);
  return b;
}

describe('AdminService', () => {
  let service: AdminService;
  let adminClient: any;

  beforeEach(async () => {
    adminClient = { from: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: SupabaseService,
          useValue: { getAdminClient: jest.fn().mockReturnValue(adminClient) },
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  // ── listUsers ────────────────────────────────────────────────────────────────

  describe('listUsers', () => {
    it('returns users for the given tenant', async () => {
      const users = [{ id: 'u1', email: 'a@test.com' }, { id: 'u2', email: 'b@test.com' }];
      adminClient.from.mockReturnValue(makeBuilder({ data: users }));

      const result = await service.listUsers('tenant-1');
      expect(result).toEqual({ users });
    });

    it('returns empty array when no users', async () => {
      adminClient.from.mockReturnValue(makeBuilder({ data: null }));
      const result = await service.listUsers('tenant-1');
      expect(result).toEqual({ users: [] });
    });

    it('throws on database error', async () => {
      adminClient.from.mockReturnValue(makeBuilder({ error: { message: 'Query failed' } }));
      await expect(service.listUsers('tenant-1')).rejects.toMatchObject({ message: 'Query failed' });
    });
  });

  // ── updateRole ───────────────────────────────────────────────────────────────

  describe('updateRole', () => {
    const updatedUser = { id: 'u1', role: UserRole.ADMIN };

    it('SUPERADMIN can assign SUPERADMIN role', async () => {
      adminClient.from.mockReturnValue(makeBuilder({ data: updatedUser }));
      const result = await service.updateRole('u1', 'tenant-1', UserRole.SUPERADMIN, UserRole.SUPERADMIN);
      expect(result).toEqual(updatedUser);
    });

    it('SUPERADMIN can assign ADMIN role', async () => {
      adminClient.from.mockReturnValue(makeBuilder({ data: updatedUser }));
      await expect(
        service.updateRole('u1', 'tenant-1', UserRole.ADMIN, UserRole.SUPERADMIN),
      ).resolves.not.toThrow();
    });

    it('SUPERADMIN can assign USER role', async () => {
      adminClient.from.mockReturnValue(makeBuilder({ data: updatedUser }));
      await expect(
        service.updateRole('u1', 'tenant-1', UserRole.USER, UserRole.SUPERADMIN),
      ).resolves.not.toThrow();
    });

    it('ADMIN can assign USER role', async () => {
      adminClient.from.mockReturnValue(makeBuilder({ data: updatedUser }));
      await expect(
        service.updateRole('u1', 'tenant-1', UserRole.USER, UserRole.ADMIN),
      ).resolves.not.toThrow();
    });

    it('ADMIN can assign ADMIN role', async () => {
      adminClient.from.mockReturnValue(makeBuilder({ data: updatedUser }));
      await expect(
        service.updateRole('u1', 'tenant-1', UserRole.ADMIN, UserRole.ADMIN),
      ).resolves.not.toThrow();
    });

    it('ADMIN cannot assign SUPERADMIN role', async () => {
      await expect(
        service.updateRole('u1', 'tenant-1', UserRole.SUPERADMIN, UserRole.ADMIN),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when user not found or cross-tenant', async () => {
      adminClient.from.mockReturnValue(makeBuilder({ data: null, error: { message: 'Not found' } }));
      await expect(
        service.updateRole('u1', 'tenant-1', UserRole.USER, UserRole.SUPERADMIN),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateStatus ─────────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('activates a user', async () => {
      const updatedUser = { id: 'u1', is_active: true };
      adminClient.from.mockReturnValue(makeBuilder({ data: updatedUser }));

      const result = await service.updateStatus('u1', 'tenant-1', true);
      expect(result).toEqual(updatedUser);
    });

    it('deactivates a user', async () => {
      const updatedUser = { id: 'u1', is_active: false };
      adminClient.from.mockReturnValue(makeBuilder({ data: updatedUser }));

      const result = await service.updateStatus('u1', 'tenant-1', false);
      expect(result).toEqual(updatedUser);
    });

    it('throws NotFoundException when user not found', async () => {
      adminClient.from.mockReturnValue(makeBuilder({ data: null, error: null }));
      await expect(service.updateStatus('u1', 'tenant-1', true)).rejects.toThrow(NotFoundException);
    });
  });

  // ── listTenants ──────────────────────────────────────────────────────────────

  describe('listTenants', () => {
    it('returns all tenants ordered by created_at desc', async () => {
      const tenants = [{ id: 't1', name: 'Acme' }, { id: 't2', name: 'Corp' }];
      adminClient.from.mockReturnValue(makeBuilder({ data: tenants }));

      const result = await service.listTenants();
      expect(result).toEqual({ tenants });
    });

    it('returns empty array when no tenants', async () => {
      adminClient.from.mockReturnValue(makeBuilder({ data: null }));
      const result = await service.listTenants();
      expect(result).toEqual({ tenants: [] });
    });

    it('throws on database error', async () => {
      adminClient.from.mockReturnValue(makeBuilder({ error: { message: 'DB error' } }));
      await expect(service.listTenants()).rejects.toMatchObject({ message: 'DB error' });
    });
  });
});
