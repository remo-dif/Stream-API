import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
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

    // Step 2: Create the application-level user profile
    // Note: The trigger on auth.users will also create a profile, but we're doing it explicitly here
    // to ensure tenant_id is set if needed
    const { error: profileError } = await this.supabaseService
      .getAdminClient()
      .from('profiles')
      .insert({
        id: data.user.id,
        email: dto.email,
        role: 'user',
        // tenant_id: dto.tenantId, // Uncomment if you have tenant_id in profiles
      });

    if (profileError) {
      // If profile creation fails, clean up the auth user
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

    return data;
  }

  async signOut(accessToken: string) {
    // Resolve the user ID from the token first
    const { data: userData, error: userError } = await this.supabaseService
      .getAdminClient()
      .auth.getUser(accessToken);

    if (userError || !userData.user) {
      throw new UnauthorizedException('Invalid token');
    }

    // Revoke the specific session
    const { error } = await this.supabaseService
      .getAdminClient()
      .auth.admin.signOut(userData.user.id, 'local');

    if (error) {
      this.logger.error(`signOut failed for user ${userData.user.id}`, error);
      throw new InternalServerErrorException('Sign out failed');
    }

    return { message: 'Signed out successfully' };
  }

  /**
   * Get the current authenticated user with their profile data
   * This is the method called by GET /api/v1/auth/user
   */
  async getUser(accessToken: string) {
    // Step 1: Get the auth user from Supabase
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .auth.getUser(accessToken);

    if (error) {
      this.logger.error(`Failed to get user from token: ${error.message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (!data.user) {
      throw new UnauthorizedException('User not found');
    }

    this.logger.debug(`Authenticated user ID: ${data.user.id}, email: ${data.user.email}`);

    // Step 2: Fetch the user's profile from the profiles table
    const { data: profile, error: profileError } = await this.supabaseService
      .getAdminClient()
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (profileError) {
      this.logger.error(
        `Profile not found for user ${data.user.id}. Error: ${profileError.message}`,
      );
      // This is the error your frontend is receiving
      throw new UnauthorizedException('User profile not found. Please complete registration.');
    }

    // Step 3: Return enriched user data combining auth user and profile
    return {
      id: data.user.id,
      email: data.user.email,
      aud: data.user.aud,
      role: data.user.role,
      // Profile data
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      user_role: profile.role, // Renamed to avoid conflict with auth role
      created_at: profile.created_at,
      updated_at: profile.updated_at,
      // You can also return the full profile object
      profile: profile,
    };
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