import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export enum TenantPlan {
  STARTER = 'starter',
  PRO = 'pro',
  ENTERPRISE = 'enterprise',
}

@Injectable()
export class TenantsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getTenant(tenantId: string) {
    if (!tenantId) {
      throw new ForbiddenException({
        error: 'User is not assigned to a tenant',
        code: 'TENANT_MEMBERSHIP_REQUIRED',
      });
    }

    const { data: tenant, error } = await this.supabaseService
      .getAdminClient()
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .single();

    if (error || !tenant) {
      throw new NotFoundException('Tenant not found');
    }

    if (tenant.is_active === false) {
      throw new HttpException(
        { error: 'Tenant account is suspended', code: 'TENANT_SUSPENDED' },
        HttpStatus.FORBIDDEN,
      );
    }

    return tenant;
  }

  async createTenant(dto: any) {
    const { data: tenant, error } = await this.supabaseService
      .getAdminClient()
      .from('tenants')
      .insert({
        name: dto.name,
        plan: dto.plan || TenantPlan.STARTER,
        token_quota: dto.tokenQuota || 1000000,
      })
      .select()
      .single();

    if (error) throw error;
    return tenant;
  }
}
