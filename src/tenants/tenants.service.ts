import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant, TenantPlan } from '../database/entities/tenant.entity';

/**
 * Tenants Service
 *
 * Manages tenant-related operations in the multi-tenant AI SaaS application.
 * Handles tenant creation, retrieval, and configuration management.
 * Tenants represent organizations or companies using the platform with
 * their own user base, quotas, and billing settings.
 */
@Injectable()
export class TenantsService {
  /**
   * Constructor - Injects the Tenant repository
   * @param tenantRepository - TypeORM repository for Tenant entity operations
   */
  constructor(
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
  ) {}

  /**
   * Get tenant by ID
   *
   * Retrieves a tenant's complete information including configuration,
   * usage statistics, and plan details. Used for tenant-specific operations
   * and displaying tenant information in the admin interface.
   *
   * @param tenantId - Unique identifier of the tenant
   * @returns Promise<Tenant> - Complete tenant object
   * @throws NotFoundException - If tenant doesn't exist
   */
  async getTenant(tenantId: string) {
    const tenant = await this.tenantRepository.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  /**
   * Create a new tenant
   *
   * Creates a new tenant organization with default settings. Sets up initial
   * token quotas and plan configuration. Used by SUPERADMIN users to onboard
   * new organizations to the platform.
   *
   * @param dto - Tenant creation data including name and optional configuration
   * @returns Promise<Tenant> - The newly created tenant object
   */
  async createTenant(dto: any) {
    const tenant = this.tenantRepository.create({
      name: dto.name,
      plan: dto.plan || TenantPlan.STARTER,
      tokenQuota: dto.tokenQuota || 1000000,
    });
    return this.tenantRepository.save(tenant);
  }
}
