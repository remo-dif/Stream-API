import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";
import { RegisterDto } from "./dto/auth.dto";

const DEFAULT_SIGNUP_TENANT_ID = "00000000-0000-0000-0000-000000000001";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private supabaseService: SupabaseService) {}

  async signUp(dto: RegisterDto) {
    // Step 1: Create the Supabase Auth user
    const { data, error } = await this.supabaseService.getClient().auth.signUp({
      email: dto.email,
      password: dto.password,
    });

    if (error) {
      if (error.message.toLowerCase().includes("already registered")) {
        throw new ConflictException("Email is already registered");
      }
      throw new UnauthorizedException(error.message);
    }

    if (!data.user) {
      throw new InternalServerErrorException("Failed to create user");
    }

    // Step 2: Create the application-level user profile
    // Note: The trigger on auth.users will also create a profile, but we're doing it explicitly here
    // to ensure tenant_id is set if needed
    const { error: profileError } = await this.supabaseService
      .getAdminClient()
      .from("profiles")
      .upsert(
        {
          id: data.user.id,
          tenant_id: dto.tenantId ?? DEFAULT_SIGNUP_TENANT_ID,
          email: dto.email,
          role: "user",
          is_active: true,
        },
        { onConflict: "id" },
      );

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
        "Failed to complete registration. Please try again.",
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
      throw new UnauthorizedException("Invalid token");
    }

    // Revoke the specific session
    const { error } = await this.supabaseService
      .getAdminClient()
      .auth.admin.signOut(userData.user.id, "local");

    if (error) {
      this.logger.error(`signOut failed for user ${userData.user.id}`, error);
      throw new InternalServerErrorException("Sign out failed");
    }

    return { message: "Signed out successfully" };
  }

  /**
   * Get the current authenticated user with their profile data
   * This is the method called by GET /api/v1/auth/user
   */
  async getUser(userId: string) {
    // Fetch the user's profile data
    const { data: profile, error: profileError } = await this.supabaseService
      .getAdminClient()
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      throw new UnauthorizedException(
        "User profile not found. Please complete registration.",
      );
    }

    return profile;
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
