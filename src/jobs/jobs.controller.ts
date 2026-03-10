import { Controller, Post, Get, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { QuotaGuard } from '../common/guards/quota.guard';
import { CurrentUser, TenantId, AuthUser } from '../common/decorators/auth.decorators';
import { JobsService } from './jobs.service';

/**
 * Jobs Controller
 *
 * Manages asynchronous AI processing jobs for the AI SaaS application.
 * Provides endpoints for submitting jobs to a queue system and checking their status.
 * Jobs are processed in the background using Bull queues for scalability.
 *
 * @ApiTags jobs - Swagger documentation tag for grouping job endpoints
 * @Controller api/v1/jobs - Base route for all job management endpoints
 * @UseGuards SupabaseAuthGuard, QuotaGuard - Requires authentication and checks usage quotas
 * @ApiBearerAuth - Requires Bearer token authentication for Swagger docs
 */
@ApiTags('jobs')
@Controller('api/v1/jobs')
@UseGuards(SupabaseAuthGuard, QuotaGuard)
@ApiBearerAuth()
export class JobsController {
  /**
   * Constructor - Injects the JobsService dependency
   * @param jobsService - Service handling job queue operations
   */
  constructor(private jobsService: JobsService) {}

  /**
   * Submit async AI job
   *
   * Submits a new asynchronous AI processing job to the queue system.
   * The job will be processed in the background and can be monitored using the job ID.
   * Supports various job types like text generation, image processing, etc.
   *
   * @param jobType - Type of AI job to submit (e.g., 'text-generation', 'image-analysis')
   * @param payload - Job-specific data and parameters
   * @param user - Currently authenticated user information
   * @param tenantId - Tenant identifier for multi-tenancy support
   * @returns Promise<Job> - Job object with ID and initial status
   */
  @Post('submit')
  @ApiOperation({ summary: 'Submit async AI job' })
  async submitJob(
    @Body('jobType') jobType: string,
    @Body('payload') payload: any,
    @CurrentUser() user: AuthUser,
    @TenantId() tenantId: string,
  ) {
    return this.jobsService.enqueueJob(jobType, payload, user.id, tenantId);
  }

  /**
   * Get job status
   *
   * Retrieves the current status and progress of a submitted job.
   * Only the job owner can check the status. Returns job state, progress,
   * and result if the job has completed.
   *
   * @param jobId - Unique identifier of the job to check
   * @param user - Currently authenticated user (for authorization)
   * @returns Promise<JobStatus> - Job status information including state and progress
   */
  @Get(':jobId')
  @ApiOperation({ summary: 'Get job status' })
  async getJobStatus(@Param('jobId') jobId: string, @CurrentUser() user: AuthUser) {
    return this.jobsService.getJobStatus(jobId, user.id);
  }
}
