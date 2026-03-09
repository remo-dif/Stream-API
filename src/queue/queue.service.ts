import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AsyncJob, JobStatus } from '../database/entities/usage-log.entity';

/**
 * Queue Service
 *
 * Manages asynchronous job processing using BullMQ queues in the AI SaaS application.
 * Handles job enqueueing, status tracking, and provides persistence layer for job metadata.
 * Uses Redis-backed queues for reliable job processing and supports priority-based execution.
 * Integrates with AI processing workers for background task execution.
 */
@Injectable()
export class QueueService {
  /** Logger instance for queue operations and job tracking */
  private readonly logger = new Logger(QueueService.name);

  /**
   * Constructor - Injects required dependencies
   * @param aiQueue - BullMQ queue for AI processing jobs
   * @param jobRepository - TypeORM repository for AsyncJob entity operations
   */
  constructor(
    @InjectQueue('ai-processing')
    private aiQueue: Queue,
    @InjectRepository(AsyncJob)
    private jobRepository: Repository<AsyncJob>,
  ) {}

  /**
   * Enqueue a new job for asynchronous processing
   *
   * Adds a job to the BullMQ queue with metadata tracking. Creates a database record
   * for job status monitoring and associates the job with the user and tenant.
   * Generates a unique job ID combining job type, user ID, and timestamp.
   *
   * @param jobType - Type of AI processing job (e.g., 'summarize', 'analyze')
   * @param payload - Job-specific data and configuration parameters
   * @param userId - ID of the user who submitted the job
   * @param tenantId - Tenant identifier for multi-tenancy support
   * @returns Promise<{jobId: string, status: string}> - Job identifier and initial status
   */
  async enqueueJob(jobType: string, payload: any, userId: string, tenantId: string) {
    const job = await this.aiQueue.add(jobType, { payload, userId, tenantId }, {
      priority: 0,
      jobId: `${jobType}-${userId}-${Date.now()}`,
    });

    await this.jobRepository.save({
      id: job.id!,
      userId,
      tenantId,
      jobType,
      status: JobStatus.QUEUED,
    });

    this.logger.log(`Job enqueued: ${job.id} (${jobType}) for user ${userId}`);
    return { jobId: job.id, status: 'queued' };
  }

  /**
   * Get current status of a queued or processing job
   *
   * Retrieves job status information from the database. Returns null if job doesn't exist.
   * Status can be QUEUED, PROCESSING, COMPLETED, FAILED, or CANCELLED.
   *
   * @param jobId - Unique identifier of the job to check
   * @returns Promise<AsyncJob | null> - Job status information or null if not found
   */
  async getJobStatus(jobId: string): Promise<AsyncJob | null> {
    return this.jobRepository.findOne({ where: { id: jobId } });
  }
}
