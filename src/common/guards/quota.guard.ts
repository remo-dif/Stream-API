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

/**
 * QuotaGuard
 *
 * FIX: This guard previously performed a read-then-check in application code,
 * creating a race condition where concurrent requests could both pass the quota
 * check before either had incremented the counter — together exceeding the limit.
 *
 * The token quota is now enforced atomically inside the increment_tenant_tokens()
 * Postgres function (see src/database/schema.sql), which uses SELECT FOR UPDATE
 * to lock the tenant row, check the quota, and increment in a single transaction.
 *
 * This guard now only checks tenant.is_active — a flag that doesn't need
 * atomicity — and attaches the tenant to the request for downstream services.
 * The actual token enforcement happens in AIService.logUsage() via the RPC.
 */
@Injectable()
export class QuotaGuard implements CanActivate {
  private readonly logger = new Logger(QuotaGuard.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.id || !user?.tenantId) {
      throw new UnauthorizedException(
        'User profile not enriched. SupabaseAuthGuard must run before QuotaGuard.',
      );
    }

    const tenantId: string = user.tenantId;

    const { data: tenant, error } = await this.supabaseService
      .getAdminClient()
      .from('tenants')
      .select('is_active, token_quota, tokens_used')
      .eq('id', tenantId)
      .single();

    if (error) {
      this.logger.error(`QuotaGuard: failed to fetch tenant ${tenantId}`, error);
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

    // Attach tenant to request so downstream services can read quota info
    // without an extra DB round-trip (e.g. for UI display purposes).
    // NOTE: This is a snapshot — the authoritative quota check is in the DB RPC.
    request.tenant = tenant;
    return true;
  }
}
