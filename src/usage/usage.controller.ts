import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantId, CurrentUser } from '../common/decorators/auth.decorators';
import { UsageService } from './usage.service';
import { RequestUser } from '../auth/jwt.strategy';

@ApiTags('usage')
@Controller('api/v1/usage')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UsageController {
  constructor(private usageService: UsageService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get usage dashboard data' })
  async getDashboard(@TenantId() tenantId: string, @CurrentUser() user: RequestUser) {
    return this.usageService.getDashboard(tenantId, user);
  }

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
