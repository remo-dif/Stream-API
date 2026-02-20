import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AsyncJob, JobStatus } from '../database/entities/usage-log.entity';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue('ai-processing')
    private aiQueue: Queue,
    @InjectRepository(AsyncJob)
    private jobRepository: Repository<AsyncJob>,
  ) {}

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

  async getJobStatus(jobId: string): Promise<AsyncJob | null> {
    return this.jobRepository.findOne({ where: { id: jobId } });
  }
}
