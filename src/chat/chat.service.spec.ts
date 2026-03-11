import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { SupabaseService } from '../supabase/supabase.service';

function makeBuilder(result: { data?: any; error?: any } = {}) {
  const resolved = { data: result.data ?? null, error: result.error ?? null };
  const b: any = {
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
  b.then = (res: any, rej: any) => Promise.resolve(resolved).then(res, rej);
  return b;
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
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  // ── getConversations ─────────────────────────────────────────────────────────

  describe('getConversations', () => {
    it('returns conversations for user within tenant', async () => {
      const conversations = [{ id: 'conv-1', title: 'Hello' }];
      adminClient.from.mockReturnValue(makeBuilder({ data: conversations }));

      const result = await service.getConversations('user-1', 'tenant-1');
      expect(result).toEqual(conversations);
      expect(adminClient.from).toHaveBeenCalledWith('conversations');
    });

    it('returns empty array when no conversations exist', async () => {
      adminClient.from.mockReturnValue(makeBuilder({ data: null }));
      const result = await service.getConversations('user-1', 'tenant-1');
      expect(result).toEqual([]);
    });

    it('throws when database returns an error', async () => {
      adminClient.from.mockReturnValue(makeBuilder({ error: { message: 'DB error' } }));
      await expect(service.getConversations('user-1', 'tenant-1')).rejects.toMatchObject({
        message: 'DB error',
      });
    });
  });

  // ── createConversation ───────────────────────────────────────────────────────

  describe('createConversation', () => {
    it('creates and returns a conversation with tenant_id', async () => {
      const conversation = { id: 'conv-1', user_id: 'user-1', tenant_id: 'tenant-1', title: 'Test' };
      adminClient.from.mockReturnValue(makeBuilder({ data: conversation }));

      const result = await service.createConversation('user-1', 'tenant-1', 'Test');
      expect(result).toEqual(conversation);
    });

    it('throws on database error', async () => {
      adminClient.from.mockReturnValue(makeBuilder({ error: { message: 'Insert failed' } }));
      await expect(service.createConversation('user-1', 'tenant-1', 'Test')).rejects.toMatchObject({
        message: 'Insert failed',
      });
    });
  });

  // ── assertConversationOwnership ──────────────────────────────────────────────

  describe('assertConversationOwnership', () => {
    it('returns conversation data when ownership verified', async () => {
      const conv = { id: 'conv-1', model: 'claude-3-5-sonnet-20241022' };
      adminClient.from.mockReturnValue(makeBuilder({ data: conv }));

      const result = await service.assertConversationOwnership('conv-1', 'user-1', 'tenant-1');
      expect(result).toEqual(conv);
    });

    it('throws NotFoundException when conversation not found', async () => {
      adminClient.from.mockReturnValue(makeBuilder({ data: null, error: { message: 'Not found' } }));
      await expect(
        service.assertConversationOwnership('conv-1', 'user-1', 'tenant-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException (not ForbiddenException) to avoid leaking existence', async () => {
      adminClient.from.mockReturnValue(makeBuilder({ data: null, error: null }));
      await expect(
        service.assertConversationOwnership('other-user-conv', 'user-1', 'tenant-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getMessages ──────────────────────────────────────────────────────────────

  describe('getMessages', () => {
    it('returns messages in chronological order (reversed from DB)', async () => {
      const messages = [
        { id: 'm-3', created_at: '2024-01-03' },
        { id: 'm-2', created_at: '2024-01-02' },
        { id: 'm-1', created_at: '2024-01-01' },
      ];
      // First call: assertConversationOwnership
      const ownershipBuilder = makeBuilder({ data: { id: 'conv-1', model: 'claude-3' } });
      // Second call: messages query
      const messagesBuilder = makeBuilder({ data: messages });

      adminClient.from
        .mockReturnValueOnce(ownershipBuilder)
        .mockReturnValueOnce(messagesBuilder);

      const result = await service.getMessages('conv-1', 'user-1', 'tenant-1');
      // Should be reversed: oldest first
      expect(result[0].id).toBe('m-1');
      expect(result[2].id).toBe('m-3');
    });

    it('caps limit at 100', async () => {
      const ownershipBuilder = makeBuilder({ data: { id: 'conv-1', model: 'claude-3' } });
      const messagesBuilder = makeBuilder({ data: [] });

      adminClient.from
        .mockReturnValueOnce(ownershipBuilder)
        .mockReturnValueOnce(messagesBuilder);

      await service.getMessages('conv-1', 'user-1', 'tenant-1', 999);
      expect(messagesBuilder.limit).toHaveBeenCalledWith(100);
    });

    it('applies before cursor when provided', async () => {
      const ownershipBuilder = makeBuilder({ data: { id: 'conv-1', model: 'claude-3' } });
      const messagesBuilder = makeBuilder({ data: [] });

      adminClient.from
        .mockReturnValueOnce(ownershipBuilder)
        .mockReturnValueOnce(messagesBuilder);

      await service.getMessages('conv-1', 'user-1', 'tenant-1', 50, '2024-01-15T00:00:00Z');
      expect(messagesBuilder.lt).toHaveBeenCalledWith('created_at', '2024-01-15T00:00:00Z');
    });
  });

  // ── saveMessage ──────────────────────────────────────────────────────────────

  describe('saveMessage', () => {
    it('inserts message and touches conversation updated_at', async () => {
      const savedMsg = { id: 'msg-1', role: 'user', content: 'Hello' };
      const insertBuilder = makeBuilder({ data: savedMsg });
      const updateBuilder = makeBuilder({ data: null });

      adminClient.from
        .mockReturnValueOnce(insertBuilder)
        .mockReturnValueOnce(updateBuilder);

      const result = await service.saveMessage('conv-1', 'user', 'Hello');
      expect(result).toEqual(savedMsg);
      expect(adminClient.from).toHaveBeenNthCalledWith(1, 'messages');
      expect(adminClient.from).toHaveBeenNthCalledWith(2, 'conversations');
      expect(updateBuilder.eq).toHaveBeenCalledWith('id', 'conv-1');
    });

    it('throws on insert error', async () => {
      adminClient.from.mockReturnValue(makeBuilder({ error: { message: 'Insert failed' } }));
      await expect(service.saveMessage('conv-1', 'user', 'Hello')).rejects.toMatchObject({
        message: 'Insert failed',
      });
    });
  });

  // ── getContextMessages ───────────────────────────────────────────────────────

  describe('getContextMessages', () => {
    it('returns messages in chronological order with correct shape', async () => {
      const raw = [
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'Hello' },
      ];
      adminClient.from.mockReturnValue(makeBuilder({ data: raw }));

      const result = await service.getContextMessages('conv-1');
      expect(result[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(result[1]).toEqual({ role: 'assistant', content: 'Hi' });
    });

    it('uses default contextWindow of 20', async () => {
      const builder = makeBuilder({ data: [] });
      adminClient.from.mockReturnValue(builder);

      await service.getContextMessages('conv-1');
      expect(builder.limit).toHaveBeenCalledWith(20);
    });

    it('returns empty array when no messages', async () => {
      adminClient.from.mockReturnValue(makeBuilder({ data: null }));
      const result = await service.getContextMessages('conv-1');
      expect(result).toEqual([]);
    });
  });
});
