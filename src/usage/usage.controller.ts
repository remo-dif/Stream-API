import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantId, CurrentUser } from '../common/decorators/auth.decorators';
import { UsageService } from './usage.service';
import { RequestUser } from '../auth/jwt.strategy';

/**
 * Usage Controller
 *
 * Provides endpoints for monitoring and analyzing AI service usage within the SaaS application.
 * Tracks token consumption, API calls, and provides dashboard analytics for tenants and users.
 * Helps with billing, quota management, and usage optimization.
 *
 * @ApiTags usage - Swagger documentation tag for grouping usage endpoints
 * @Controller api/v1/usage - Base route for all usage tracking endpoints
 * @UseGuards JwtAuthGuard - Requires authentication for all endpoints
 * @ApiBearerAuth - Requires Bearer token authentication for Swagger docs
 */
@ApiTags('usage')
@Controller('api/v1/usage')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UsageController {
  /**
   * Constructor - Injects the UsageService dependency
   * @param usageService - Service handling usage analytics and reporting
   */
  constructor(private usageService: UsageService) {}

  /**
   * Get usage dashboard data
   *
   * Retrieves comprehensive usage statistics and analytics for the current tenant.
   * Includes token consumption, API call counts, usage trends, and quota information.
   * Used for displaying usage dashboards and monitoring service utilization.
   *
   * @param tenantId - Tenant identifier for multi-tenancy support
   * @param user - Currently authenticated user information
   * @returns Promise<DashboardData> - Usage dashboard with metrics and charts
   */
  @Get('dashboard')
  @ApiOperation({ summary: 'Get usage dashboard data' })
  async getDashboard(@TenantId() tenantId: string, @CurrentUser() user: RequestUser) {
    return this.usageService.getDashboard(tenantId, user);
  }

  /**
   * Get usage logs
   *
   * Retrieves paginated usage log entries for the tenant. Each log entry represents
   * an individual API call or token consumption event with timestamps and metadata.
   * Useful for detailed usage analysis and debugging.
   *
   * @param tenantId - Tenant identifier for multi-tenancy support
   * @param page - Page number for pagination (default: 1)
   * @param limit - Number of log entries per page (default: 50)
   * @returns Promise<{logs: UsageLog[], total: number, page: number, limit: number}>
   */
  @Get('logs')
  @ApiOperation({ summary: 'Get usage logs' })
  async getLogs(
    @TenantId() tenantId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 50,
  ) {
    return this.usageService.getLogs(tenantId, page, limit);
  }
}
