import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, TenantId } from '../common/decorators/auth.decorators';
import { UserRole } from '../database/entities/user.entity';
import { TenantsService } from './tenants.service';

/**
 * Tenants Controller
 *
 * Manages tenant-related operations in the multi-tenant AI SaaS application.
 * Provides endpoints for retrieving current tenant information and creating new tenants.
 * Most operations are restricted to authenticated users, with tenant creation limited to SUPERADMIN.
 *
 * @ApiTags tenants - Swagger documentation tag for grouping tenant endpoints
 * @Controller api/v1/tenants - Base route for all tenant management endpoints
 * @UseGuards SupabaseAuthGuard - Requires authentication for all endpoints using Supabase
 * @ApiBearerAuth - Requires Bearer token authentication for Swagger docs
 */
@ApiTags('tenants')
@Controller('api/v1/tenants')
@UseGuards(SupabaseAuthGuard)
@ApiBearerAuth()
export class TenantsController {
  /**
   * Constructor - Injects the TenantsService dependency
   * @param tenantsService - Service handling tenant business logic
   */
  constructor(private tenantsService: TenantsService) {}

  /**
   * Get current tenant information
   *
   * Retrieves detailed information about the current user's tenant including
   * tenant settings, usage statistics, and configuration.
   *
   * @param tenantId - Tenant identifier extracted from JWT token
   * @returns Promise<Tenant> - Complete tenant object with all details
   */
  @Get('current')
  async getCurrentTenant(@TenantId() tenantId: string) {
    return this.tenantsService.getTenant(tenantId);
  }

  /**
   * Create new tenant (superadmin only)
   *
   * Creates a new tenant in the system. This operation is restricted to SUPERADMIN users
   * and is used for setting up new organizations or companies in the multi-tenant system.
   *
   * @param dto - Tenant creation data including name, settings, and configuration
   * @returns Promise<Tenant> - The newly created tenant object
   */
  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPERADMIN)
  async createTenant(@Body() dto: any) {
    return this.tenantsService.createTenant(dto);
  }
}
