import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { AsyncJob, JobResult, JobStatus } from '../database/entities/usage-log.entity';
import { AIService } from '../chat/ai.service';

@Processor('ai-processing')
export class AIJobProcessor extends WorkerHost {
  private readonly logger = new Logger(AIJobProcessor.name);

  constructor(
    @InjectRepository(AsyncJob)
    private jobRepository: Repository<AsyncJob>,
    private aiService: AIService,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    const { payload, userId, tenantId } = job.data;
    this.logger.log(`Processing job ${job.id} (${job.name})`);

    await this.jobRepository.update(job.id!, { status: JobStatus.PROCESSING, startedAt: new Date() });

    try {
      let result;
      switch (job.name) {
        case 'summarize':
          result = await this.aiService.complete({
            messages: [{ role: 'user', content: `Summarize this: ${payload.text}` }],
            maxTokens: 512,
            userId,
            tenantId,
            conversationId: null,
          });
          break;
        case 'analyze':
          result = await this.aiService.complete({
            messages: [{ role: 'user', content: `Analyze: ${payload.text}` }],
            maxTokens: 1024,
            userId,
            tenantId,
            conversationId: null,
          });
          break;
        case 'translate':
          result = await this.aiService.complete({
            messages: [{ role: 'user', content: `Translate to ${payload.targetLang}: ${payload.text}` }],
            maxTokens: 2048,
            userId,
            tenantId,
            conversationId: null,
          });
          break;
        default:
          throw new Error(`Unknown job type: ${job.name}`);
      }

      await this.jobRepository.update(job.id!, {
        status: JobStatus.COMPLETED,
        result: result as JobResult,
        completedAt: new Date(),
      });

      return result;
    } catch (error: any) {
      this.logger.error(`Job ${job.id} failed: ${error.message}`);
      await this.jobRepository.update(job.id!, {
        status: JobStatus.FAILED,
        error: error.message,
      });
      throw error;
    }
  }
}
