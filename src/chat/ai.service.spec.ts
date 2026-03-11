import { Test, TestingModule } from '@nestjs/testing';
import { RequestTimeoutException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIService } from './ai.service';
import { SupabaseService } from '../supabase/supabase.service';

// Mock the entire Anthropic SDK
jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        stream: jest.fn(),
        create: jest.fn(),
      },
    })),
  };
});

import Anthropic from '@anthropic-ai/sdk';

describe('AIService', () => {
  let service: AIService;
  let mockAnthropic: any;
  let adminClient: any;

  beforeEach(async () => {
    adminClient = {
      from: jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnThis(),
        then: (res: any) => Promise.resolve({ data: null, error: null }).then(res),
      }),
      rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIService,
        {
          provide: SupabaseService,
          useValue: { getAdminClient: jest.fn().mockReturnValue(adminClient) },
        },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('sk-ant-test-key') },
        },
      ],
    }).compile();

    service = module.get<AIService>(AIService);
    // Grab the mocked Anthropic instance created inside the service
    mockAnthropic = (Anthropic as unknown as jest.Mock).mock.results[0]?.value;
  });

  // ── streamChatResponse ───────────────────────────────────────────────────────

  describe('streamChatResponse', () => {
    it('calls anthropic.messages.stream with correct parameters', () => {
      const mockStream = { on: jest.fn() };
      mockAnthropic.messages.stream.mockReturnValue(mockStream);

      const messages = [{ role: 'user' as const, content: 'Hello' }];
      const result = service.streamChatResponse({ messages, model: 'claude-3-5-sonnet-20241022' });

      expect(result).toBe(mockStream);
      expect(mockAnthropic.messages.stream).toHaveBeenCalledWith({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        messages,
      });
    });

    it('uses default model when none specified', () => {
      const mockStream = { on: jest.fn() };
      mockAnthropic.messages.stream.mockReturnValue(mockStream);

      service.streamChatResponse({ messages: [] });

      expect(mockAnthropic.messages.stream).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-3-5-sonnet-20241022' }),
      );
    });
  });

  // ── createCompletion ─────────────────────────────────────────────────────────

  describe('createCompletion', () => {
    it('returns text and token counts on success', async () => {
      mockAnthropic.messages.create.mockResolvedValue({
        content: [{ type: 'text', text: 'Hello there!' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const result = await service.createCompletion({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result).toEqual({ text: 'Hello there!', inputTokens: 10, outputTokens: 5 });
    });

    it('concatenates multiple text blocks', async () => {
      mockAnthropic.messages.create.mockResolvedValue({
        content: [
          { type: 'text', text: 'Part 1 ' },
          { type: 'text', text: 'Part 2' },
        ],
        usage: { input_tokens: 20, output_tokens: 10 },
      });

      const result = await service.createCompletion({ messages: [] });
      expect(result.text).toBe('Part 1 Part 2');
    });

    it('throws RequestTimeoutException when AbortError is raised', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockAnthropic.messages.create.mockRejectedValue(abortError);

      await expect(service.createCompletion({ messages: [] })).rejects.toThrow(
        RequestTimeoutException,
      );
    });

    it('rethrows non-abort errors', async () => {
      mockAnthropic.messages.create.mockRejectedValue(new Error('Network error'));
      await expect(service.createCompletion({ messages: [] })).rejects.toThrow('Network error');
    });
  });

  // ── logUsage ─────────────────────────────────────────────────────────────────

  describe('logUsage', () => {
    const usageData = {
      userId: 'user-1',
      tenantId: 'tenant-1',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    };

    it('inserts usage_log and calls increment_tenant_tokens RPC', async () => {
      await service.logUsage(usageData);

      expect(adminClient.from).toHaveBeenCalledWith('usage_logs');
      expect(adminClient.rpc).toHaveBeenCalledWith('increment_tenant_tokens', {
        p_tenant_id: 'tenant-1',
        p_tokens: 150,
      });
    });

    it('includes conversationId when provided', async () => {
      await service.logUsage({ ...usageData, conversationId: 'conv-1' });

      const insertBuilder = adminClient.from.mock.results[0]?.value;
      expect(insertBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ conversation_id: 'conv-1' }),
      );
    });

    it('sets conversation_id to null when not provided', async () => {
      await service.logUsage(usageData);

      const insertBuilder = adminClient.from.mock.results[0]?.value;
      expect(insertBuilder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ conversation_id: null }),
      );
    });

    it('does not throw when DB insert fails (errors are swallowed)', async () => {
      adminClient.from.mockReturnValue({
        insert: jest.fn().mockReturnThis(),
        then: (res: any) => Promise.resolve({ data: null, error: { message: 'DB down' } }).then(res),
      });

      await expect(service.logUsage(usageData)).resolves.toBeUndefined();
    });

    it('does not throw when RPC fails (errors are swallowed)', async () => {
      adminClient.rpc.mockResolvedValue({ data: null, error: { message: 'RPC error' } });
      await expect(service.logUsage(usageData)).resolves.toBeUndefined();
    });

    it('does not throw even if Promise.all throws', async () => {
      adminClient.rpc.mockRejectedValue(new Error('Unexpected'));
      await expect(service.logUsage(usageData)).resolves.toBeUndefined();
    });
  });
});
