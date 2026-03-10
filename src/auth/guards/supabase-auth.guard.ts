import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

/**
 * SupabaseAuthGuard
 *
 * Validates the Bearer token via Supabase Auth, then enriches request.user
 * with role and tenantId fetched from the user_profiles table.
 *
 * Without this enrichment:
 *  - RolesGuard always fails (user.role is undefined)
 *  - @TenantId() always returns undefined
 *  - QuotaGuard makes a redundant duplicate DB fetch
 *
 * After this guard runs, request.user is guaranteed to have:
 *  { id, email, role, tenantId, ...supabaseAuthFields }
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseAuthGuard.name);

  constructor(private supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization;

    if (!authorization) {
      throw new UnauthorizedException('No authorization header');
    }

    const [type, token] = authorization.split(' ');
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization header format');
    }

    try {
      // Step 1: Validate token with Supabase Auth
      const { data, error } = await this.supabaseService
        .getAdminClient()
        .auth.getUser(token);

      if (error || !data.user) {
        throw new UnauthorizedException('Invalid or expired token');
      }

      // Step 2: Fetch app-level profile (role, tenant) from user_profiles
      const { data: profile, error: profileError } = await this.supabaseService
        .getAdminClient()
        .from('user_profiles')
        .select('role, tenant_id, is_active')
        .eq('id', data.user.id)
        .single();

      if (profileError || !profile) {
        // Profile missing means the user was created in Supabase Auth but
        // signup did not complete the profile step — treat as unauthorized.
        this.logger.warn(
          `User ${data.user.id} has no user_profiles row. Signup may be incomplete.`,
        );
        throw new UnauthorizedException(
          'User profile not found. Please complete registration.',
        );
      }

      if (!profile.is_active) {
        throw new UnauthorizedException('User account is deactivated');
      }

      // Step 3: Attach enriched user to request
      request.user = {
        ...data.user,
        role: profile.role,
        tenantId: profile.tenant_id,
      };

      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      this.logger.error('Auth guard error', err);
      throw new UnauthorizedException('Authentication failed');
    }
  }
}
