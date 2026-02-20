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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private redis: Redis;
  private readonly TOKEN_EXPIRY = '24h';
  private readonly REFRESH_TOKEN_EXPIRY = '30d';
  private readonly SALT_ROUNDS = 12;

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
