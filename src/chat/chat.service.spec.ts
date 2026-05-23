import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service';
import { SupabaseService } from '../supabase/supabase.service';

function makeBuilder(result: { data?: any; error?: any } = {}) {
  const resolved = { data: result.data ?? null, error: result.error ?? null };
  const builder: any = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resolved),
  };
  builder.then = (resolve: any, reject: any) =>
    Promise.resolve(resolved).then(resolve, reject);
  return builder;
}

describe('ChatService', () => {
  let service: ChatService;
  let adminClient: any;

  beforeEach(async () => {
    adminClient = { from: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: SupabaseService,
          useValue: { getAdminClient: jest.fn().mockReturnValue(adminClient) },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => {
              if (key === 'LLM_PROVIDER') return 'openai';
              if (key === 'OPENAI_MODEL') return 'gpt-4.1-mini';
              return fallback;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  it('creates conversations with the configured default model', async () => {
    const conversation = {
      id: 'conv-1',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      title: 'Test',
      model: 'gpt-4.1-mini',
    };
    const builder = makeBuilder({ data: conversation });
    adminClient.from.mockReturnValue(builder);

    await expect(
      service.createConversation('user-1', 'tenant-1', 'Test'),
    ).resolves.toEqual(conversation);
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        model: 'gpt-4.1-mini',
      }),
    );
  });

  it('throws ForbiddenException when tenantId is missing', async () => {
    await expect(service.getConversations('user-1', '')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns ownership-scoped conversations', async () => {
    const conversations = [{ id: 'conv-1', title: 'Hello' }];
    adminClient.from.mockReturnValue(makeBuilder({ data: conversations }));

    await expect(
      service.getConversations('user-1', 'tenant-1'),
    ).resolves.toEqual(conversations);
  });

  it('throws NotFoundException when ownership check fails', async () => {
    adminClient.from.mockReturnValue(
      makeBuilder({ data: null, error: { message: 'missing' } }),
    );

    await expect(
      service.assertConversationOwnership('conv-1', 'user-1', 'tenant-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('caps message pagination at 100', async () => {
    const ownershipBuilder = makeBuilder({
      data: { id: 'conv-1', model: 'gpt-4.1-mini' },
    });
    const messagesBuilder = makeBuilder({ data: [] });

    adminClient.from
      .mockReturnValueOnce(ownershipBuilder)
      .mockReturnValueOnce(messagesBuilder);

    await service.getMessages('conv-1', 'user-1', 'tenant-1', 500);
    expect(messagesBuilder.limit).toHaveBeenCalledWith(100);
  });

  it('returns context messages in chronological order', async () => {
    adminClient.from.mockReturnValue(
      makeBuilder({
        data: [
          { role: 'assistant', content: 'Hi' },
          { role: 'user', content: 'Hello' },
        ],
      }),
    );

    await expect(service.getContextMessages('conv-1')).resolves.toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]);
  });
});
