import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant, TenantPlan } from '../database/entities/tenant.entity';

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
  ) {}

  async getTenant(tenantId: string) {
    const tenant = await this.tenantRepository.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async createTenant(dto: any) {
    const tenant = this.tenantRepository.create({
      name: dto.name,
      plan: dto.plan || TenantPlan.STARTER,
      tokenQuota: dto.tokenQuota || 1000000,
    });
    return this.tenantRepository.save(tenant);
  }
}
