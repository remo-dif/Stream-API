import {
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { RegisterDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private supabaseService: SupabaseService) {}

  async signUp(dto: RegisterDto) {
    // Step 1: Create the Supabase Auth user
    const { data, error } = await this.supabaseService
      .getClient()
      .auth.signUp({
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

    // Step 2: Create the application-level user profile.
    // This links the Supabase auth user to a tenant with a role.
    // NOTE: In production, replace this with a Postgres trigger on auth.users
    // to guarantee atomicity (trigger: after insert on auth.users → insert user_profiles).
    const { error: profileError } = await this.supabaseService
      .getAdminClient()
      .from('user_profiles')
      .insert({
        id: data.user.id,
        email: dto.email,
        tenant_id: dto.tenantId,
        role: 'user',
        is_active: true,
      });

    if (profileError) {
      // Cleanup: delete the orphaned auth user so the email can be re-used.
      // If cleanup itself fails we log a CRITICAL alert with the user ID so it
      // can be purged manually — we still throw so the caller sees a failure.
      this.logger.error(
        `Failed to create user_profiles for ${data.user.id}. Attempting auth user cleanup.`,
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

    return data;
  }

  /**
   * Revokes the user's session server-side using the admin client.
   * The anon client's signOut() is a no-op when there is no browser session.
   */
  async signOut(accessToken: string) {
    // Resolve the user ID from the token first
    const { data: userData, error: userError } = await this.supabaseService
      .getAdminClient()
      .auth.getUser(accessToken);

    if (userError || !userData.user) {
      throw new UnauthorizedException('Invalid token');
    }

    // Revoke the specific session (scope: 'local' invalidates only this token)
    const { error } = await this.supabaseService
      .getAdminClient()
      .auth.admin.signOut(userData.user.id, 'local');

    if (error) {
      this.logger.error(`signOut failed for user ${userData.user.id}`, error);
      throw new InternalServerErrorException('Sign out failed');
    }

    return { message: 'Signed out successfully' };
  }

  async getUser(accessToken: string) {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .auth.getUser(accessToken);

    if (error) {
      throw new UnauthorizedException(error.message);
    }

    return data.user;
  }

  async refreshSession(refreshToken: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .auth.refreshSession({ refresh_token: refreshToken });

    if (error) {
      throw new UnauthorizedException(error.message);
    }

    return data;
  }
}
