import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { RegisterDto } from './dto/auth.dto';

const DEFAULT_SIGNUP_TENANT_ID = '00000000-0000-0000-0000-000000000001';

type UserProfile = {
  id: string;
  email?: string;
  role: string;
  tenant_id: string | null;
  is_active: boolean;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async signUp(dto: RegisterDto) {
    const { data, error } = await this.supabaseService.getClient().auth.signUp({
      email: dto.email,
      password: dto.password,
    });

    if (error) {
      if (error.message.toLowerCase().includes('already registered')) {
        throw new ConflictException('Email is already registered');
      }
      throw new UnauthorizedException(error.message);
    }

    if (!data.user) {
      throw new InternalServerErrorException('Failed to create user');
    }

    const { error: profileError } = await this.supabaseService
      .getAdminClient()
      .from('profiles')
      .upsert(
        {
          id: data.user.id,
          tenant_id: dto.tenantId ?? DEFAULT_SIGNUP_TENANT_ID,
          email: dto.email,
          role: 'user',
          is_active: true,
        },
        { onConflict: 'id' },
      );

    if (profileError) {
      this.logger.error(
        `Failed to create profile for ${data.user.id}. Attempting cleanup.`,
        profileError,
      );

      const { error: cleanupError } = await this.supabaseService
        .getAdminClient()
        .auth.admin.deleteUser(data.user.id);

      if (cleanupError) {
        this.logger.error(
          `CRITICAL: Failed to delete orphaned auth user ${data.user.id}. Manual cleanup required.`,
          cleanupError,
        );
      }

      throw new InternalServerErrorException(
        'Failed to complete registration. Please try again.',
      );
    }

    return {
      user: {
        id: data.user.id,
        email: data.user.email,
      },
      session: data.session,
    };
  }

  async signIn(email: string, password: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .auth.signInWithPassword({ email, password });

    if (error) {
      throw new UnauthorizedException(error.message);
    }

    if (!data.user) {
      throw new UnauthorizedException('Authentication failed');
    }

    await this.assertActiveProfile(data.user.id);
    return data;
  }

  async signOut(accessToken: string) {
    const { data: userData, error: userError } = await this.supabaseService
      .getAdminClient()
      .auth.getUser(accessToken);

    if (userError || !userData.user) {
      throw new UnauthorizedException('Invalid token');
    }

    const { error } = await this.supabaseService
      .getAdminClient()
      .auth.admin.signOut(userData.user.id, 'local');

    if (error) {
      this.logger.error(`signOut failed for user ${userData.user.id}`, error);
      throw new InternalServerErrorException('Sign out failed');
    }

    return { message: 'Signed out successfully' };
  }

  async getUser(userId: string) {
    return this.assertActiveProfile(userId);
  }

  async refreshSession(refreshToken: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .auth.refreshSession({ refresh_token: refreshToken });

    if (error) {
      throw new UnauthorizedException(error.message);
    }

    if (data.user) {
      await this.assertActiveProfile(data.user.id);
    }

    return data;
  }

  private async assertActiveProfile(userId: string): Promise<UserProfile> {
    const { data: profile, error } = await this.supabaseService
      .getAdminClient()
      .from('profiles')
      .select('id, email, role, tenant_id, is_active')
      .eq('id', userId)
      .single();

    if (error || !profile) {
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

    return profile as UserProfile;
  }
}
