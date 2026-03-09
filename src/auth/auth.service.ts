import { Injectable, UnauthorizedException, ConflictException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { User, UserRole } from '../database/entities/user.entity';
import { Tenant } from '../database/entities/tenant.entity';
import { RegisterDto, LoginDto, AuthResponseDto } from './dto/auth.dto';
import { JwtPayload } from './jwt.strategy';

/**
 * Authentication Service
 *
 * Handles all authentication-related business logic for the AI SaaS application.
 * Implements secure user registration, login, JWT token management, and session handling.
 * Uses bcrypt for password hashing, Redis for token storage/blacklisting, and supports
 * multi-tenant authentication with role-based access control.
 */
@Injectable()
export class AuthService {
  /** Logger instance for authentication events and errors */
  private readonly logger = new Logger(AuthService.name);

  /** Redis client for token storage and blacklisting */
  private redis: Redis;

  /** JWT access token expiry time (24 hours) */
  private readonly TOKEN_EXPIRY = '24h';

  /** JWT refresh token expiry time (30 days) */
  private readonly REFRESH_TOKEN_EXPIRY = '30d';

  /** Number of salt rounds for bcrypt password hashing */
  private readonly SALT_ROUNDS = 12;

  /**
   * Constructor - Injects required dependencies and initializes Redis
   * @param userRepository - TypeORM repository for User entity operations
   * @param tenantRepository - TypeORM repository for Tenant entity operations
   * @param jwtService - NestJS JWT service for token generation and verification
   * @param configService - Configuration service for environment variables
   */
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    this.redis = new Redis(configService.get<string>('REDIS_URL') || 'redis://localhost:6379');
  }

  /**
   * Register a new user
   *
   * Creates a new user account with secure password hashing. Automatically assigns
   * USER role if not specified. Validates that email is not already registered
   * within the tenant. Creates audit log entry for the registration.
   *
   * @param dto - Registration data including email, password, and tenant ID
   * @returns Promise<User> - Created user object (without password hash)
   * @throws ConflictException - If email is already registered in the tenant
   */
  async register(dto: RegisterDto): Promise<Omit<User, 'passwordHash'>> {
    // Check if user exists
    const existing = await this.userRepository.findOne({
      where: { email: dto.email, tenantId: dto.tenantId },
    });

    if (existing) {
      throw new ConflictException('Email already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(dto.password, this.SALT_ROUNDS);

    // Create user
    const user = this.userRepository.create({
      email: dto.email,
      passwordHash,
      tenantId: dto.tenantId,
      role: dto.role || UserRole.USER,
    });

    const saved = await this.userRepository.save(user);
    this.logger.log(`User registered: ${saved.email} (tenant: ${saved.tenantId})`);

    const { passwordHash: _, ...userWithoutPassword } = saved;
    return userWithoutPassword;
  }

  /**
   * Authenticate user and generate tokens
   *
   * Validates user credentials, generates JWT access and refresh tokens,
   * and stores the refresh token in Redis for security. Updates last login timestamp.
   * Only active users can authenticate.
   *
   * @param dto - Login credentials (email and password)
   * @returns Promise<AuthResponseDto> - Access token, refresh token, and user info
   * @throws UnauthorizedException - If credentials are invalid or user is inactive
   */
  async login(dto: LoginDto): Promise<AuthResponseDto> {
    // Find user with tenant
    const user = await this.userRepository.findOne({
      where: { email: dto.email, isActive: true },
      relations: ['tenant'],
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      this.logger.warn(`Failed login attempt: ${dto.email}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate tokens
    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.TOKEN_EXPIRY,
    });

    const refreshToken = this.jwtService.sign(
      { userId: user.id, type: 'refresh' },
      {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.REFRESH_TOKEN_EXPIRY,
      },
    );

    // Store refresh token
    await this.redis.setex(
      `refresh:${user.id}:${refreshToken.slice(-16)}`,
      30 * 86400,
      refreshToken,
    );

    // Update last login
    await this.userRepository.update(user.id, { lastLoginAt: new Date() });

    this.logger.log(`User logged in: ${user.email}`);

    return {
      accessToken,
      refreshToken,
      expiresIn: 86400,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        tenantName: user.tenant.name,
        plan: user.tenant.plan,
      },
    };
  }

  /**
   * Logout user and blacklist token
   *
   * Invalidates the current access token by adding it to Redis blacklist.
   * The token remains blacklisted until its natural expiry time.
   * Logs the logout event for security auditing.
   *
   * @param userId - ID of the user logging out
   * @param token - JWT access token to blacklist
   * @returns Promise<void>
   */
  async logout(userId: string, token: string): Promise<void> {
    try {
      const decoded = this.jwtService.decode(token) as any;
      const ttl = decoded?.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 3600;
      if (ttl > 0) {
        await this.redis.setex(`blacklist:${token}`, ttl, '1');
      }
      this.logger.log(`User logged out: ${userId}`);
    } catch (error) {
      this.logger.error('Logout error:', error);
    }
  }

  /**
   * Refresh access token using refresh token
   *
   * Validates the refresh token and generates a new access token without requiring
   * re-authentication. The refresh token must be valid and the user must still be active.
   * Does not extend the refresh token's lifetime.
   *
   * @param refreshToken - Valid refresh token from login
   * @returns Promise<{accessToken: string, expiresIn: number}> - New access token
   * @throws UnauthorizedException - If refresh token is invalid or user is inactive
   */
  async refreshTokens(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
    try {
      const decoded = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      }) as any;

      if (decoded.type !== 'refresh') {
        throw new UnauthorizedException('Invalid token type');
      }

      const user = await this.userRepository.findOne({
        where: { id: decoded.userId, isActive: true },
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      const payload: JwtPayload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      };

      const accessToken = this.jwtService.sign(payload, {
        expiresIn: this.TOKEN_EXPIRY,
      });

      return { accessToken, expiresIn: 86400 };
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}
