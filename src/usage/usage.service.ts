import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { UsageLog } from '../database/entities/usage-log.entity';
import { User } from '../database/entities/user.entity';

@Injectable()
export class UsageService {
  private redis: Redis;

  constructor(
    @InjectRepository(UsageLog)
    private usageLogRepository: Repository<UsageLog>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    configService: ConfigService,
  ) {
    this.redis = new Redis(configService.get<string>('REDIS_URL') || 'redis://localhost:6379');
  }

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
