import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class QuotaGuard implements CanActivate {
  constructor(private supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.id) {
      return true; // Let auth guard handle this
    }

    try {
      // Get user's tenant from user_profiles
      const { data: profile, error: profileError } = await this.supabaseService
        .getAdminClient()
        .from('user_profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (profileError || !profile) {
        return true; // No profile found, let other guards handle
      }

      const tenantId = profile.tenant_id;

      // Get tenant quota info
      const { data: tenant, error: tenantError } = await this.supabaseService
        .getAdminClient()
        .from('tenants')
        .select('token_quota, tokens_used')
        .eq('id', tenantId)
        .single();

      if (tenantError || !tenant) {
        throw new HttpException('Tenant not found', HttpStatus.INTERNAL_SERVER_ERROR);
      }

      if (tenant.token_quota > 0 && tenant.tokens_used >= tenant.token_quota) {
        throw new HttpException(
          {
            error: 'Token quota exceeded',
            code: 'QUOTA_EXCEEDED',
            quota: tenant.token_quota,
            used: tenant.tokens_used,
            resetDate: new Date(Date.now() + 86400000).toISOString(),
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Attach tenant to request for later use
      request.tenant = tenant;
      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // If any other error, allow request to proceed
      return true;
    }
  }
}
