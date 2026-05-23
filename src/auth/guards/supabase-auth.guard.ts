import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../../supabase/supabase.service';

type ProfileRecord = {
  role: string;
  tenant_id: string | null;
  is_active: boolean;
};

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseAuthGuard.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

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
      const { data, error } = await this.supabaseService
        .getAdminClient()
        .auth.getUser(token);

      if (error || !data.user) {
        throw new UnauthorizedException('Invalid or expired token');
      }

      const profile = await this.getActiveProfile(data.user.id);

      request.user = {
        ...data.user,
        role: profile.role,
        tenantId: profile.tenant_id,
      };

      return true;
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      this.logger.error('Auth guard error', error);
      throw new UnauthorizedException('Authentication failed');
    }
  }

  private async getActiveProfile(userId: string): Promise<ProfileRecord> {
    const { data: profile, error } = await this.supabaseService
      .getAdminClient()
      .from('profiles')
      .select('role, tenant_id, is_active')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      this.logger.warn(
        `User ${userId} has no profile row. Signup may be incomplete.`,
      );
      throw new UnauthorizedException(
        'User profile not found. Please complete registration.',
      );
    }

    if (!profile.is_active) {
      throw new ForbiddenException('User account is deactivated');
    }

    if (!profile.tenant_id) {
      throw new ForbiddenException({
        error: 'User is not assigned to a tenant',
        code: 'TENANT_MEMBERSHIP_REQUIRED',
      });
    }

    return profile as ProfileRecord;
  }
}
