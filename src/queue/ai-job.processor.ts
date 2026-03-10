import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AIService } from '../chat/ai.service';

const JOB_PROMPTS: Record<
  string,
  (payload: Record<string, any>) => string
> = {
  summarize: (p) =>
    `Summarize the following text concisely:\n\n${p.text}`,
  analyze: (p) =>
    `Provide a detailed analysis of the following:\n\n${p.text}`,
  translate: (p) =>
    `Translate the following text to ${p.targetLang}. Respond with only the translation:\n\n${p.text}`,
};

@Processor('ai-processing')
export class AIJobProcessor extends WorkerHost {
  private readonly logger = new Logger(AIJobProcessor.name);

  constructor(private readonly aiService: AIService) {
    super();
  }

  /**
   * Process a background AI job.
   *
   * Uses the NON-STREAMING API (createCompletion) — streaming is only
   * valid for HTTP SSE endpoints, not for background queue workers.
   *
   * The method always resolves (BullMQ marks completed) or throws (BullMQ
   * marks failed and retries according to the queue's backoff config).
   */
  async process(job: Job<{
    payload: Record<string, any>;
    userId: string;
    tenantId: string;
  }>): Promise<{ text: string }> {
    const { payload, userId, tenantId } = job.data;

    const buildPrompt = JOB_PROMPTS[job.name];
    if (!buildPrompt) {
      // Throw a non-retryable error for unknown job types
      throw new Error(`Unknown job type: "${job.name}"`);
    }

    this.logger.log(
      `Starting job ${job.id} type="${job.name}" user=${userId} tenant=${tenantId}`,
    );

    await job.updateProgress(10);

    const promptText = buildPrompt(payload);
    const { text, inputTokens, outputTokens } =
      await this.aiService.createCompletion({
        messages: [{ role: 'user', content: promptText }],
      });

    await job.updateProgress(80);

    // Log usage — errors are swallowed inside logUsage, so this never breaks the job
    await this.aiService.logUsage({
      userId,
      tenantId,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    });

    await job.updateProgress(100);

    this.logger.log(
      `Completed job ${job.id} type="${job.name}" tokens=${inputTokens + outputTokens}`,
    );

    return { text };
  }
}
