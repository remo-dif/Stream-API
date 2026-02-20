import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles, TenantId } from '../common/decorators/auth.decorators';
import { UserRole } from '../database/entities/user.entity';
import { AdminService } from './admin.service';

@ApiTags('admin')
@Controller('api/v1/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
@ApiBearerAuth()
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('users')
  @ApiOperation({ summary: 'List all users in tenant' })
  async listUsers(@TenantId() tenantId: string) {
    return this.adminService.listUsers(tenantId);
  }

  @Patch('users/:id/role')
  @ApiOperation({ summary: 'Update user role' })
  async updateRole(
    @Param('id') userId: string,
    @Body('role') role: UserRole,
    @TenantId() tenantId: string,
  ) {
    return this.adminService.updateRole(userId, tenantId, role);
  }

  @Patch('users/:id/status')
  @ApiOperation({ summary: 'Activate/deactivate user' })
  async updateStatus(
    @Param('id') userId: string,
    @Body('isActive') isActive: boolean,
    @TenantId() tenantId: string,
  ) {
    return this.adminService.updateStatus(userId, tenantId, isActive);
  }

  @Get('tenants')
  @Roles(UserRole.SUPERADMIN)
  @ApiOperation({ summary: 'List all tenants (superadmin only)' })
  async listTenants() {
    return this.adminService.listTenants();
  }
}
