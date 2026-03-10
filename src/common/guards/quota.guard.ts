import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class QuotaGuard implements CanActivate {
  private readonly logger = new Logger(QuotaGuard.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // SupabaseAuthGuard must run first and enrich request.user with tenantId.
    // Fail closed: if the enriched profile is missing, deny access rather than
    // silently bypassing quota enforcement.
    if (!user?.id || !user?.tenantId) {
      throw new UnauthorizedException(
        'User profile not enriched. SupabaseAuthGuard must run before QuotaGuard.',
      );
    }

    const tenantId: string = user.tenantId;

    const { data: tenant, error } = await this.supabaseService
      .getAdminClient()
      .from('tenants')
      .select('token_quota, tokens_used, is_active')
      .eq('id', tenantId)
      .single();

    if (error) {
      // DB failure → log, do NOT silently pass (could allow unlimited usage)
      this.logger.error(
        `QuotaGuard: failed to fetch tenant ${tenantId}`,
        error,
      );
      throw new HttpException(
        'Service temporarily unavailable. Please try again.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!tenant) {
      throw new HttpException('Tenant not found', HttpStatus.FORBIDDEN);
    }

    if (!tenant.is_active) {
      throw new HttpException(
        { error: 'Tenant account is suspended', code: 'TENANT_SUSPENDED' },
        HttpStatus.FORBIDDEN,
      );
    }

    if (tenant.token_quota > 0 && tenant.tokens_used >= tenant.token_quota) {
      throw new HttpException(
        {
          error: 'Token quota exceeded for this billing period',
          code: 'QUOTA_EXCEEDED',
          quota: tenant.token_quota,
          used: tenant.tokens_used,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Attach tenant to request so downstream services can avoid a re-fetch
    request.tenant = tenant;
    return true;
  }
}
