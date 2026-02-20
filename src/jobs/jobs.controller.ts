import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { QuotaGuard } from '../common/guards/quota.guard';
import { CurrentUser, TenantId } from '../common/decorators/auth.decorators';
import { JobsService } from './jobs.service';
import { RequestUser } from '../auth/jwt.strategy';

@ApiTags('jobs')
@Controller('api/v1/jobs')
@UseGuards(JwtAuthGuard, QuotaGuard)
@ApiBearerAuth()
export class JobsController {
  constructor(private jobsService: JobsService) {}

  @Post('submit')
  @ApiOperation({ summary: 'Submit async AI job' })
  async submitJob(
    @Body('jobType') jobType: string,
    @Body('payload') payload: any,
    @CurrentUser() user: RequestUser,
    @TenantId() tenantId: string,
  ) {
    return this.jobsService.enqueueJob(jobType, payload, user.id, tenantId);
  }

  @Get(':jobId')
  @ApiOperation({ summary: 'Get job status' })
  async getJobStatus(@Param('jobId') jobId: string, @CurrentUser() user: RequestUser) {
    return this.jobsService.getJobStatus(jobId, user.id);
  }
}
