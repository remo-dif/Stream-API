import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, TenantId } from '../common/decorators/auth.decorators';
import { UserRole } from '../database/entities/user.entity';
import { AdminService } from './admin.service';

/**
 * Admin Controller
 *
 * Provides administrative endpoints for managing users and tenants within the AI SaaS application.
 * Requires ADMIN or SUPERADMIN role for access. SUPERADMIN can manage all tenants,
 * while ADMIN can only manage users within their own tenant.
 *
 * @ApiTags admin - Swagger documentation tag for grouping admin endpoints
 * @Controller api/v1/admin - Base route for all admin endpoints
 * @UseGuards JwtAuthGuard, RolesGuard - Requires authentication and role-based authorization
 * @Roles ADMIN, SUPERADMIN - Restricts access to admin roles only
 * @ApiBearerAuth - Requires Bearer token authentication for Swagger docs
 */
@ApiTags('admin')
@Controller('api/v1/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
@ApiBearerAuth()
export class AdminController {
  /**
   * Constructor - Injects the AdminService dependency
   * @param adminService - Service handling admin business logic
   */
  constructor(private adminService: AdminService) {}

  /**
   * List all users in tenant
   *
   * Retrieves a list of all users within the current tenant. Accessible by ADMIN and SUPERADMIN roles.
   * SUPERADMIN can see users across all tenants, while ADMIN sees only their tenant's users.
   *
   * @param tenantId - Tenant identifier for multi-tenancy support
   * @returns Promise<User[]> - Array of user objects in the tenant
   */
  @Get('users')
  @ApiOperation({ summary: 'List all users in tenant' })
  async listUsers(@TenantId() tenantId: string) {
    return this.adminService.listUsers(tenantId);
  }

  /**
   * Update user role
   *
   * Changes the role of a specific user within the tenant. Only SUPERADMIN can promote users to SUPERADMIN.
   * ADMIN role can only assign USER or ADMIN roles within their tenant.
   *
   * @param userId - Unique identifier of the user to update
   * @param role - New role to assign (USER, ADMIN, or SUPERADMIN)
   * @param tenantId - Tenant identifier for multi-tenancy support
   * @returns Promise<User> - Updated user object
   */
  @Patch('users/:id/role')
  @ApiOperation({ summary: 'Update user role' })
  async updateRole(
    @Param('id') userId: string,
    @Body('role') role: UserRole,
    @TenantId() tenantId: string,
  ) {
    return this.adminService.updateRole(userId, tenantId, role);
  }

  /**
   * Activate/deactivate user
   *
   * Enables or disables a user account within the tenant. Deactivated users cannot authenticate
   * or access the system until reactivated.
   *
   * @param userId - Unique identifier of the user to update
   * @param isActive - New active status (true for active, false for deactivated)
   * @param tenantId - Tenant identifier for multi-tenancy support
   * @returns Promise<User> - Updated user object
   */
  @Patch('users/:id/status')
  @ApiOperation({ summary: 'Activate/deactivate user' })
  async updateStatus(
    @Param('id') userId: string,
    @Body('isActive') isActive: boolean,
    @TenantId() tenantId: string,
  ) {
    return this.adminService.updateStatus(userId, tenantId, isActive);
  }

  /**
   * List all tenants (superadmin only)
   *
   * Retrieves a list of all tenants in the system. This endpoint is restricted to SUPERADMIN role only
   * and provides system-wide tenant management capabilities.
   *
   * @returns Promise<Tenant[]> - Array of all tenant objects
   */
  @Get('tenants')
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'List all tenants (superadmin only)' })
  async listTenants() {
    return this.adminService.listTenants();
  }
}
