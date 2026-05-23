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
              model: 'gpt-4.1-mini',
            }),
            logUsage: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    processor = module.get<AIJobProcessor>(AIJobProcessor);
    aiService = module.get(AIService);
  });

  it('returns the text result for summarize jobs', async () => {
    const job = makeJob('summarize', {
      payload: { text: 'Long text...' },
      userId: 'u1',
      tenantId: 't1',
    });

    await expect(processor.process(job)).resolves.toEqual({
      text: 'Result text',
    });
  });

  it('passes the prompt to createCompletion', async () => {
    const job = makeJob('translate', {
      payload: { text: 'Hello', targetLang: 'Spanish' },
      userId: 'u1',
      tenantId: 't1',
    });

    await processor.process(job);

    expect(aiService.createCompletion).toHaveBeenCalledWith({
      messages: [{ role: 'user', content: expect.stringContaining('Spanish') }],
    });
  });

  it('logs usage with the returned model', async () => {
    const job = makeJob('summarize', {
      payload: { text: 'test' },
      userId: 'u1',
      tenantId: 't1',
    });

    await processor.process(job);

    expect(aiService.logUsage).toHaveBeenCalledWith({
      userId: 'u1',
      tenantId: 't1',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      model: 'gpt-4.1-mini',
    });
  });

  it('updates progress through the happy path', async () => {
    const job = makeJob('summarize', {
      payload: { text: 'test' },
      userId: 'u1',
      tenantId: 't1',
    });

    await processor.process(job);

    expect(job.updateProgress).toHaveBeenNthCalledWith(1, 10);
    expect(job.updateProgress).toHaveBeenNthCalledWith(2, 80);
    expect(job.updateProgress).toHaveBeenNthCalledWith(3, 100);
  });

  it('throws for unsupported job types', async () => {
    const job = makeJob('hack', { payload: {}, userId: 'u1', tenantId: 't1' });

    await expect(processor.process(job)).rejects.toThrow(
      'Unknown job type: "hack"',
    );
    expect(aiService.createCompletion).not.toHaveBeenCalled();
  });
});
