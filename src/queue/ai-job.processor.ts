import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AIService } from '../chat/ai.service';

@Processor('ai-processing')
export class AIJobProcessor extends WorkerHost {
  private readonly logger = new Logger(AIJobProcessor.name);

  constructor(private aiService: AIService) {
    super();
  }

  async process(job: Job): Promise<any> {
    const { payload, userId, tenantId } = job.data;
    this.logger.log(`Processing job ${job.id} (${job.name})`);

    try {
      let result;
      switch (job.name) {
        case 'summarize':
          result = await this.aiService.streamChatResponse({
            messages: [{ role: 'user', content: `Summarize this: ${payload.text}` }],
            userId,
            conversationId: null,
          });
          break;
        case 'analyze':
          result = await this.aiService.streamChatResponse({
            messages: [{ role: 'user', content: `Analyze: ${payload.text}` }],
            userId,
            conversationId: null,
          });
          break;
        case 'translate':
          result = await this.aiService.streamChatResponse({
            messages: [{ role: 'user', content: `Translate to ${payload.targetLang}: ${payload.text}` }],
            userId,
            conversationId: null,
          });
          break;
        default:
          throw new Error(`Unknown job type: ${job.name}`);
      }

      this.logger.log(`Job ${job.id} completed successfully`);
      return result;
    } catch (error: any) {
      this.logger.error(`Job ${job.id} failed: ${error.message}`);
      throw error;
    }
  }
}
