import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  SUPERADMIN = 'superadmin',
}

@Injectable()
export class AdminService {
  constructor(private supabaseService: SupabaseService) {}

  async listUsers(tenantId: string) {
    const { data: users, error } = await this.supabaseService
      .getAdminClient()
      .from('user_profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { users: users || [] };
  }

  async updateRole(
    userId: string,
    tenantId: string,
    role: UserRole,
    requesterRole: UserRole,
  ) {
    // SUPERADMIN can assign any role; ADMIN can only assign USER or ADMIN
    const validRoles =
      requesterRole === UserRole.SUPERADMIN
        ? [UserRole.USER, UserRole.ADMIN, UserRole.SUPERADMIN]
        : [UserRole.USER, UserRole.ADMIN];

    if (!validRoles.includes(role)) {
      throw new BadRequestException(`Role must be one of: ${validRoles.join(', ')}`);
    }

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('user_profiles')
      .update({ role })
      .eq('id', userId)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error || !data) {
      throw new NotFoundException('User not found');
    }

    return data;
  }

  async updateStatus(userId: string, tenantId: string, isActive: boolean) {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('user_profiles')
      .update({ is_active: isActive })
      .eq('id', userId)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error || !data) {
      throw new NotFoundException('User not found');
    }

    return data;
  }

  async listTenants() {
    const { data: tenants, error } = await this.supabaseService
      .getAdminClient()
      .from('tenants')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { tenants: tenants || [] };
  }
}
