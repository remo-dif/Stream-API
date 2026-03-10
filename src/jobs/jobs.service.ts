import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';

/**
 * Jobs Service
 *
 * High-level service for managing asynchronous AI processing jobs in the SaaS application.
 * Provides a clean API for job submission and status checking, with validation and
 * authorization. Delegates actual queue operations to the QueueService for scalability.
 * Supports various job types like summarization, analysis, and translation.
 */
@Injectable()
export class JobsService {
  /**
   * Constructor - Injects the QueueService dependency
   * @param queueService - Service handling Bull queue operations
   */
  constructor(private queueService: QueueService) {}

  /**
   * Enqueue a new asynchronous job
   *
   * Validates the job type and submits it to the queue system for background processing.
   * Associates the job with the user and tenant for proper authorization and billing.
   * Supported job types include summarization, analysis, and translation tasks.
   *
   * @param jobType - Type of job to execute (summarize, analyze, translate)
   * @param payload - Job-specific data and parameters
   * @param userId - ID of the user submitting the job
   * @param tenantId - Tenant identifier for multi-tenancy support
   * @returns Promise<Job> - Job object with ID and initial status
   * @throws BadRequestException - If job type is not supported
   */
  async enqueueJob(jobType: string, payload: any, userId: string, tenantId: string) {
    const validJobTypes = ['summarize', 'analyze', 'translate'];
    if (!validJobTypes.includes(jobType)) {
      throw new BadRequestException(`jobType must be one of: ${validJobTypes.join(', ')}`);
    }

    return this.queueService.enqueueJob(jobType, payload, userId, tenantId);
  }

  /**
   * Get status of a submitted job
   *
   * Retrieves the current status and progress of an asynchronous job.
   * Only the job owner can check the status. Returns job state, progress,
   * and result if the job has completed successfully.
   *
   * @param jobId - Unique identifier of the job to check
   * @param userId - ID of the user requesting status (for authorization)
   * @returns Promise<JobStatus> - Job status information including state and progress
   * @throws NotFoundException - If job doesn't exist or user doesn't own it
   */
  async getJobStatus(jobId: string, userId: string) {
    const job = await this.queueService.getJobStatus(jobId);
    if (!job || job.data.userId !== userId) {
      throw new NotFoundException('Job not found');
    }
    return job;
  }
}
