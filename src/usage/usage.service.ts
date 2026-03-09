import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { UsageLog } from '../database/entities/usage-log.entity';
import { User } from '../database/entities/user.entity';

/**
 * Usage Service
 *
 * Provides comprehensive usage analytics and reporting for the AI SaaS application.
 * Tracks token consumption, API usage patterns, and generates dashboard metrics.
 * Combines database-stored usage logs with real-time Redis counters for accurate
 * billing and quota management. Supports tenant-level and user-level analytics.
 */
@Injectable()
export class UsageService {
  /** Redis client for real-time usage counters and caching */
  private redis: Redis;

  /**
   * Constructor - Initializes Redis connection and injects repositories
   * @param usageLogRepository - TypeORM repository for UsageLog entity operations
   * @param userRepository - TypeORM repository for User entity operations
   * @param configService - Configuration service for Redis connection settings
   */
  constructor(
    @InjectRepository(UsageLog)
    private usageLogRepository: Repository<UsageLog>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    configService: ConfigService,
  ) {
    this.redis = new Redis(configService.get<string>('REDIS_URL') || 'redis://localhost:6379');
  }

  /**
   * Get comprehensive usage dashboard data
   *
   * Generates a complete usage dashboard including quota status, today's usage,
   * 30-day summary statistics, and daily breakdown. Combines data from database
   * and Redis for real-time accuracy. Used for displaying usage analytics
   * and monitoring consumption patterns.
   *
   * @param tenantId - Tenant identifier for multi-tenancy support
   * @param user - Currently authenticated user with tenant information
   * @returns Promise<DashboardData> - Complete usage dashboard with metrics and trends
   */
  async getDashboard(tenantId: string, user: any) {
    const today = new Date().toISOString().split('T')[0];
    const todayTokens = parseInt((await this.redis.get(`usage:${tenantId}:${today}`)) || '0');

    const summary = await this.usageLogRepository
      .createQueryBuilder('ul')
      .select('SUM(ul.total_tokens)', 'totalTokens')
      .addSelect('SUM(ul.input_tokens)', 'inputTokens')
      .addSelect('SUM(ul.output_tokens)', 'outputTokens')
      .addSelect('COUNT(*)', 'requestCount')
      .addSelect('AVG(ul.total_tokens)', 'avgTokensPerRequest')
      .where('ul.tenant_id = :tenantId', { tenantId })
      .andWhere("ul.created_at >= NOW() - INTERVAL '30 days'")
      .getRawOne();

    const daily = await this.usageLogRepository
      .createQueryBuilder('ul')
      .select("DATE(ul.created_at)", 'date')
      .addSelect('SUM(ul.total_tokens)', 'tokens')
      .addSelect('COUNT(*)', 'requests')
      .where('ul.tenant_id = :tenantId', { tenantId })
      .andWhere("ul.created_at >= NOW() - INTERVAL '30 days'")
      .groupBy('DATE(ul.created_at)')
      .orderBy('date', 'ASC')
      .getRawMany();

    return {
      quota: {
        total: user.tenant.tokenQuota,
        used: user.tenant.tokensUsed,
        percentage:
          user.tenant.tokenQuota > 0
            ? Math.round((user.tenant.tokensUsed / user.tenant.tokenQuota) * 100)
            : 0,
      },
      today: { tokens: todayTokens },
      last30Days: summary,
      dailyBreakdown: daily,
    };
  }

  /**
   * Get paginated usage logs
   *
   * Retrieves detailed usage log entries for a tenant with pagination support.
   * Each log entry contains information about individual API calls, token usage,
   * and associated user information. Useful for detailed usage analysis and auditing.
   *
   * @param tenantId - Tenant identifier for multi-tenancy support
   * @param page - Page number for pagination (default: 1)
   * @param limit - Number of log entries per page (default: 50)
   * @returns Promise<{logs: UsageLog[], page: number, limit: number, total: number}>
   */
  async getLogs(tenantId: string, page: number = 1, limit: number = 50) {
    const [logs, total] = await this.usageLogRepository.findAndCount({
      where: { tenantId },
      relations: ['user'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { logs, page, limit, total };
  }
}
