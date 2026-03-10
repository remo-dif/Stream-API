import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class ChatService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getConversations(userId: string, tenantId: string) {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('conversations')
      .select('id, title, model, is_archived, created_at, updated_at')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId) // tenant isolation
      .eq('is_archived', false)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
  }

  async createConversation(userId: string, tenantId: string, title: string) {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('conversations')
      .insert({
        user_id: userId,
        tenant_id: tenantId, // was missing — caused NOT NULL DB constraint violation
        title,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Fetches messages with:
   *  1. Ownership check — conversation must belong to the requesting user within the tenant.
   *  2. Cursor-based pagination — avoids loading thousands of messages into memory.
   */
  async getMessages(
    conversationId: string,
    userId: string,
    tenantId: string,
    limit: number = 50,
    before?: string, // ISO timestamp cursor
  ) {
    // Verify ownership and tenant membership in a single query
    await this.assertConversationOwnership(conversationId, userId, tenantId);

    const safeLimit = Math.min(limit, 100); // cap at 100 per page

    let query = this.supabaseService
      .getAdminClient()
      .from('messages')
      .select('id, role, content, tokens, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(safeLimit);

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Return in chronological order (oldest first) for rendering
    return (data ?? []).reverse();
  }

  async saveMessage(
    conversationId: string,
    role: string,
    content: string,
    tokens?: number,
  ) {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('messages')
      .insert({ conversation_id: conversationId, role, content, tokens })
      .select()
      .single();

    if (error) throw error;

    // Touch the conversation updated_at so ordering stays correct
    await this.supabaseService
      .getAdminClient()
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    return data;
  }

  /**
   * Verifies a conversation belongs to userId + tenantId.
   * Throws NotFoundException (not ForbiddenException) to avoid leaking existence.
   */
  async assertConversationOwnership(
    conversationId: string,
    userId: string,
    tenantId: string,
  ): Promise<{ id: string; model: string }> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('conversations')
      .select('id, model')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .eq('tenant_id', tenantId) // prevents cross-tenant reads
      .single();

    if (error || !data) {
      throw new NotFoundException('Conversation not found');
    }

    return data;
  }

  /**
   * Fetches recent message history for feeding into the AI context window.
   * Limited to the most recent `contextWindow` messages to stay within token budgets.
   */
  async getContextMessages(
    conversationId: string,
    contextWindow: number = 20,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: false })
      .limit(contextWindow);

    if (error) throw error;

    return ((data ?? []).reverse() as any[]).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content as string,
    }));
  }
}
