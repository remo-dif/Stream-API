import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  HttpException,
  InternalServerErrorException,
  RequestTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIService } from './ai.service';
import { SupabaseService } from '../supabase/supabase.service';

const anthropicCreate = jest.fn();
const anthropicStream = jest.fn();
const openaiCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: {
      create: anthropicCreate,
      stream: anthropicStream,
    },
  })),
}));

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: openaiCreate,
      },
    },
  })),
}));

function makeConfig(overrides: Record<string, string | undefined> = {}) {
  return {
    get: jest.fn((key: string, fallback?: string) => overrides[key] ?? fallback),
  };
}

describe('AIService', () => {
  let service: AIService;
  let adminClient: any;

  beforeEach(() => {
    anthropicCreate.mockReset();
    anthropicStream.mockReset();
    openaiCreate.mockReset();
    adminClient = {
      from: jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnThis(),
        then: (resolve: any) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      }),
      rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
  });

  async function createService(
    overrides: Record<string, string | undefined> = {},
  ) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIService,
        {
          provide: SupabaseService,
          useValue: { getAdminClient: jest.fn().mockReturnValue(adminClient) },
        },
        {
          provide: ConfigService,
          useValue: makeConfig({
            LLM_PROVIDER: 'openai',
            OPENAI_API_KEY: 'sk-openai',
            OPENAI_MODEL: 'gpt-4.1-mini',
            ANTHROPIC_API_KEY: 'sk-ant',
            ANTHROPIC_MODEL: 'claude-3-5-sonnet-20241022',
            ...overrides,
          }),
        },
      ],
    }).compile();

    service = module.get<AIService>(AIService);
  }

  it('uses OpenAI by default for non-streaming completions', async () => {
    await createService();
    openaiCreate.mockResolvedValue({
      model: 'gpt-4.1-mini',
      choices: [{ message: { content: 'Hello there!' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    await expect(
      service.createCompletion({ messages: [{ role: 'user', content: 'Hi' }] }),
    ).resolves.toEqual({
      text: 'Hello there!',
      inputTokens: 10,
      outputTokens: 5,
      model: 'gpt-4.1-mini',
    });
  });

  it('routes claude models to Anthropic', async () => {
    await createService();
    anthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Anthropic reply' }],
      usage: { input_tokens: 12, output_tokens: 6 },
    });

    await expect(
      service.createCompletion({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'claude-3-5-sonnet-20241022',
      }),
    ).resolves.toEqual({
      text: 'Anthropic reply',
      inputTokens: 12,
      outputTokens: 6,
      model: 'claude-3-5-sonnet-20241022',
    });
  });

  it('throws BadRequestException for unknown model prefixes', async () => {
    await createService();

    await expect(
      service.createCompletion({
        messages: [{ role: 'user', content: 'Hi' }],
        model: 'mystery-model',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws when the requested provider is not configured', async () => {
    await createService({ OPENAI_API_KEY: undefined });

    await expect(
      service.createCompletion({ messages: [{ role: 'user', content: 'Hi' }] }),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('maps aborts to RequestTimeoutException', async () => {
    await createService();
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    openaiCreate.mockRejectedValue(abortError);

    await expect(
      service.createCompletion({ messages: [{ role: 'user', content: 'Hi' }] }),
    ).rejects.toThrow(RequestTimeoutException);
  });

  it('streams OpenAI text deltas and captures final usage', async () => {
    await createService();
    openaiCreate.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield {
          model: 'gpt-4.1-mini',
          choices: [{ delta: { content: 'Hello ' } }],
        };
        yield {
          model: 'gpt-4.1-mini',
          choices: [{ delta: { content: 'world' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        };
      },
    });

    const stream = await service.streamChatResponse({
      messages: [{ role: 'user', content: 'Hi' }],
    });

    const chunks: string[] = [];
    for await (const event of stream) {
      chunks.push(event.text);
    }

    await expect(stream.finalResponse()).resolves.toEqual({
      inputTokens: 10,
      outputTokens: 5,
      model: 'gpt-4.1-mini',
    });
    expect(chunks.join('')).toBe('Hello world');
  });

  it('keeps quota exceptions intact when logging usage', async () => {
    await createService();
    adminClient.rpc.mockResolvedValue({
      data: null,
      error: { message: 'QUOTA_EXCEEDED' },
    });

    await expect(
      service.logUsage({
        userId: 'user-1',
        tenantId: 'tenant-1',
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        model: 'gpt-4.1-mini',
      }),
    ).rejects.toThrow(HttpException);
  });
});
