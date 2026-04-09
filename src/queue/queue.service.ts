import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/**
 * Queue Service
 *
 * Manages asynchronous job processing using BullMQ queues in the AI SaaS application.
 * Handles job enqueueing and status tracking using Redis-backed queues for reliable
 * job processing and supports priority-based execution.
 * Integrates with AI processing workers for background task execution.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue('ai-processing')
    private aiQueue: Queue,
  ) {}

  /**
   * Enqueue a new job for asynchronous processing
   *
   * Adds a job to the BullMQ queue with metadata tracking.
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

    this.logger.log(`Job enqueued: ${job.id} (${jobType}) for user ${userId}`);
    return { jobId: job.id, status: 'queued' };
  }

  /**
   * Get current status of a queued or processing job
   *
   * Retrieves job status information from the BullMQ queue.
   * Status can be QUEUED, PROCESSING, COMPLETED, FAILED, or CANCELLED.
   *
   * @param jobId - Unique identifier of the job to check
   * @returns Promise<any> - Job status information or null if not found
   */
  async getJobStatus(jobId: string) {
    const job = await this.aiQueue.getJob(jobId);
    if (!job) return null;

    return {
      id: job.id,
      name: job.name,
      status: await job.getState(),
      progress: job.progress,
      data: job.data,
      result: job.returnvalue,
    };
  }

  async listJobs(limit: number = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const jobs = await this.aiQueue.getJobs(
      ['waiting', 'active', 'completed', 'failed', 'delayed'],
      0,
      safeLimit - 1,
      false,
    );

    const entries = await Promise.all(
      jobs.map(async (job) => ({
        id: job.id,
        name: job.name,
        status: await job.getState(),
        progress: job.progress,
        data: job.data,
        result: job.returnvalue,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        opts: job.opts,
        timestamp: job.timestamp,
        finishedOn: job.finishedOn,
      })),
    );

    return entries.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  }
}
