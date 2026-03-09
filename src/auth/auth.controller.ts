import { Controller, Post, Body, Get, UseGuards, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, RefreshTokenDto, AuthResponseDto } from './dto/auth.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequestUser } from './jwt.strategy';

/**
 * Authentication Controller
 *
 * Handles all authentication-related operations for the AI SaaS application including
 * user registration, login, logout, token refresh, and profile management.
 * Implements JWT-based authentication with refresh token support.
 *
 * @ApiTags auth - Swagger documentation tag for grouping authentication endpoints
 * @Controller api/v1/auth - Base route for all authentication endpoints
 */
@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  /**
   * Constructor - Injects the AuthService dependency
   * @param authService - Service handling authentication business logic
   */
  constructor(private authService: AuthService) {}

  /**
   * Register new user
   *
   * Creates a new user account with the provided registration details.
   * Automatically creates a new tenant for the user and assigns USER role.
   * Sends a welcome email if email service is configured.
   *
   * @param dto - Registration data including email, password, and optional name
   * @returns Promise<{message: string, userId: string}> - Success message with user ID
   */
  @Post('register')
  @ApiOperation({ summary: 'Register new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(@Body() dto: RegisterDto) {
    const user = await this.authService.register(dto);
    return { message: 'User registered successfully', userId: user.id };
  }

  /**
   * Login and get access token
   *
   * Authenticates user credentials and returns JWT access and refresh tokens.
   * The access token is short-lived, while the refresh token is long-lived for
   * obtaining new access tokens without re-authentication.
   *
   * @param dto - Login credentials (email and password)
   * @returns Promise<AuthResponseDto> - Access token, refresh token, and user info
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login and get access token' })
  @ApiResponse({ status: 200, description: 'Login successful', type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.authService.login(dto);
  }

  /**
   * Logout and revoke token
   *
   * Invalidates the current access token and optionally the refresh token.
   * The token is added to a blacklist to prevent further use.
   *
   * @param req - Express request object containing authenticated user
   * @returns Promise<{message: string}> - Success confirmation
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and revoke token' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(@Req() req: Request & { user: RequestUser }) {
    const token = (req.headers as any).authorization?.slice(7);
    await this.authService.logout(req.user.id, token);
    return { message: 'Logged out successfully' };
  }

  /**
   * Refresh access token
   *
   * Exchanges a valid refresh token for a new access token without requiring
   * re-authentication. The refresh token remains valid for future use.
   *
   * @param dto - Refresh token data
   * @returns Promise<AuthResponseDto> - New access token and user info
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  /**
   * Get current user profile
   *
   * Returns the authenticated user's profile information including tenant details
   * and usage statistics (token quota and tokens used).
   *
   * @param req - Express request object containing authenticated user
   * @returns Promise<UserProfile> - User profile with tenant and usage info
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile' })
  async getProfile(@Req() req: Request & { user: RequestUser }) {
    const { passwordHash, ...user } = req.user;
    return {
      ...user,
      tokenQuota: req.user.tenant.tokenQuota,
      tokensUsed: req.user.tenant.tokensUsed,
    };
  }
}
