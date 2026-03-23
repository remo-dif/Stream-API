/**
 * JwtAuthGuard — REMOVED
 *
 * This file previously contained a Passport JWT guard that was never registered
 * and never used. The entire Passport + passport-jwt + @nestjs/passport + @nestjs/jwt
 * dependency chain has been removed from package.json.
 *
 * Authentication is handled exclusively by SupabaseAuthGuard, which validates
 * Bearer tokens via the Supabase Admin API and enriches request.user with
 * role and tenantId from the user_profiles table.
 *
 * See: src/auth/guards/supabase-auth.guard.ts
 */
export {};
