import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../../database/entities/tenant.entity';

@Injectable()
export class QuotaGuard implements CanActivate {
  constructor(
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return true; // Let auth guard handle this
    }

    const tenant = await this.tenantRepository.findOne({
      where: { id: user.tenantId },
    });

    if (!tenant) {
      throw new HttpException('Tenant not found', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    if (tenant.tokenQuota > 0 && tenant.tokensUsed >= tenant.tokenQuota) {
      throw new HttpException(
        {
          error: 'Token quota exceeded',
          code: 'QUOTA_EXCEEDED',
          quota: tenant.tokenQuota,
          used: tenant.tokensUsed,
          resetDate: new Date(Date.now() + 86400000).toISOString(),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Attach tenant to request for later use
    request.tenant = tenant;
    return true;
  }
}
