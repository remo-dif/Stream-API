import { Test, TestingModule } from '@nestjs/testing';
import { AIJobProcessor } from './ai-job.processor';
import { AIService } from '../chat/ai.service';

function makeJob(name: string, data: Record<string, any>) {
  return {
    id: 'job-123',
    name,
    data,
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as any;
}

describe('AIJobProcessor', () => {
  let processor: AIJobProcessor;
  let aiService: jest.Mocked<AIService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIJobProcessor,
        {
          provide: AIService,
          useValue: {
            createCompletion: jest.fn().mockResolvedValue({
              text: 'Result text',
              inputTokens: 100,
              outputTokens: 50,
            }),
            logUsage: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    processor = module.get<AIJobProcessor>(AIJobProcessor);
    aiService = module.get(AIService);
  });

  // ── summarize ────────────────────────────────────────────────────────────────

  describe('summarize jobs', () => {
    it('returns text result', async () => {
      const job = makeJob('summarize', { payload: { text: 'Long text...' }, userId: 'u1', tenantId: 't1' });
      const result = await processor.process(job);
      expect(result).toEqual({ text: 'Result text' });
    });

    it('passes the correct summarize prompt to createCompletion', async () => {
      const job = makeJob('summarize', { payload: { text: 'Hello world' }, userId: 'u1', tenantId: 't1' });
      await processor.process(job);

      expect(aiService.createCompletion).toHaveBeenCalledWith({
        messages: [
          { role: 'user', content: expect.stringContaining('Hello world') },
        ],
      });
      expect(aiService.createCompletion).toHaveBeenCalledWith({
        messages: [
          { role: 'user', content: expect.stringContaining('Summarize') },
        ],
      });
    });
  });

  // ── analyze ──────────────────────────────────────────────────────────────────

  describe('analyze jobs', () => {
    it('passes the correct analyze prompt', async () => {
      const job = makeJob('analyze', { payload: { text: 'Data to analyze' }, userId: 'u1', tenantId: 't1' });
      await processor.process(job);

      expect(aiService.createCompletion).toHaveBeenCalledWith({
        messages: [
          { role: 'user', content: expect.stringContaining('analysis') },
        ],
      });
    });
  });

  // ── translate ────────────────────────────────────────────────────────────────

  describe('translate jobs', () => {
    it('passes the correct translate prompt with target language', async () => {
      const job = makeJob('translate', {
        payload: { text: 'Hello', targetLang: 'Spanish' },
        userId: 'u1',
        tenantId: 't1',
      });
      await processor.process(job);

      expect(aiService.createCompletion).toHaveBeenCalledWith({
        messages: [
          { role: 'user', content: expect.stringContaining('Spanish') },
        ],
      });
    });
  });

  // ── progress tracking ────────────────────────────────────────────────────────

  describe('progress updates', () => {
    it('updates progress to 10, 80, and 100 in sequence', async () => {
      const job = makeJob('summarize', { payload: { text: 'test' }, userId: 'u1', tenantId: 't1' });
      await processor.process(job);

      expect(job.updateProgress).toHaveBeenNthCalledWith(1, 10);
      expect(job.updateProgress).toHaveBeenNthCalledWith(2, 80);
      expect(job.updateProgress).toHaveBeenNthCalledWith(3, 100);
    });
  });

  // ── usage logging ────────────────────────────────────────────────────────────

  describe('usage logging', () => {
    it('logs usage with correct token totals', async () => {
      const job = makeJob('summarize', { payload: { text: 'test' }, userId: 'u1', tenantId: 't1' });
      await processor.process(job);

      expect(aiService.logUsage).toHaveBeenCalledWith({
        userId: 'u1',
        tenantId: 't1',
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });
    });
  });

  // ── unknown job type ─────────────────────────────────────────────────────────

  describe('unknown job type', () => {
    it('throws an error for unrecognized job names', async () => {
      const job = makeJob('unknown-job', { payload: {}, userId: 'u1', tenantId: 't1' });
      await expect(processor.process(job)).rejects.toThrow('Unknown job type: "unknown-job"');
    });

    it('does not call createCompletion for unknown job types', async () => {
      const job = makeJob('hack', { payload: {}, userId: 'u1', tenantId: 't1' });
      await expect(processor.process(job)).rejects.toThrow();
      expect(aiService.createCompletion).not.toHaveBeenCalled();
    });
  });
});
