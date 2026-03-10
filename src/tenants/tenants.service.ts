import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export enum TenantPlan {
  STARTER = 'starter',
  PRO = 'pro',
  ENTERPRISE = 'enterprise',
}

@Injectable()
export class TenantsService {
  constructor(private supabaseService: SupabaseService) {}

  async getTenant(tenantId: string) {
    const { data: tenant, error } = await this.supabaseService
      .getAdminClient()
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .single();

    if (error || !tenant) {
      throw new NotFoundException('Tenant not found');
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
