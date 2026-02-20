import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';

@Injectable()
export class JobsService {
  constructor(private queueService: QueueService) {}

  async enqueueJob(jobType: string, payload: any, userId: string, tenantId: string) {
    const validJobTypes = ['summarize', 'analyze', 'translate'];
    if (!validJobTypes.includes(jobType)) {
      throw new BadRequestException(`jobType must be one of: ${validJobTypes.join(', ')}`);
    }

    return this.queueService.enqueueJob(jobType, payload, userId, tenantId);
  }

  async getJobStatus(jobId: string, userId: string) {
    const job = await this.queueService.getJobStatus(jobId);
    if (!job || job.userId !== userId) {
      throw new NotFoundException('Job not found');
    }
    return job;
  }
}
