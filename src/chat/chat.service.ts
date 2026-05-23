import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { DEFAULT_MODEL_BY_PROVIDER, LlmProvider } from './llm.constants';

@Injectable()
export class ChatService {
  private readonly defaultModel: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    const provider = this.configService.get<LlmProvider>(
      'LLM_PROVIDER',
      LlmProvider.OPENAI,
    );

    this.defaultModel =
      provider === LlmProvider.OPENAI
        ? this.configService.get<string>(
            'OPENAI_MODEL',
            DEFAULT_MODEL_BY_PROVIDER[LlmProvider.OPENAI],
          )
        : this.configService.get<string>(
            'ANTHROPIC_MODEL',
            DEFAULT_MODEL_BY_PROVIDER[LlmProvider.ANTHROPIC],
          );
  }

  async getConversations(userId: string, tenantId: string) {
    this.assertTenantId(tenantId);

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('conversations')
      .select('id, title, model, is_archived, created_at, updated_at')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .eq('is_archived', false)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return data ?? [];
  }

  async createConversation(userId: string, tenantId: string, title: string) {
    this.assertTenantId(tenantId);

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('conversations')
      .insert({
        user_id: userId,
        tenant_id: tenantId,
        title,
        model: this.defaultModel,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getConversation(
    conversationId: string,
    userId: string,
    tenantId: string,
  ) {
    this.assertTenantId(tenantId);

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('conversations')
      .select('id, title, model, is_archived, created_at, updated_at')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Conversation not found');
    }

    return data;
  }

  async archiveConversation(
    conversationId: string,
    userId: string,
    tenantId: string,
  ) {
    this.assertTenantId(tenantId);

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('conversations')
      .update({
        is_archived: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId)
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .select('id')
      .single();

    if (error || !data) {
      throw new NotFoundException('Conversation not found');
    }

    return { success: true };
  }

  async getMessages(
    conversationId: string,
    userId: string,
    tenantId: string,
    limit: number = 50,
    before?: string,
  ) {
    this.assertTenantId(tenantId);
    await this.assertConversationOwnership(conversationId, userId, tenantId);

    const safeLimit = Math.min(limit, 100);

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

    await this.supabaseService
      .getAdminClient()
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId);

    return data;
  }

  async assertConversationOwnership(
    conversationId: string,
    userId: string,
    tenantId: string,
  ): Promise<{ id: string; model: string }> {
    this.assertTenantId(tenantId);

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('conversations')
      .select('id, model')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Conversation not found');
    }

    return data;
  }

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

    return ((data ?? []).reverse() as any[]).map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: message.content as string,
    }));
  }

  private assertTenantId(tenantId?: string): asserts tenantId is string {
    if (!tenantId) {
      throw new ForbiddenException({
        error: 'User is not assigned to a tenant',
        code: 'TENANT_MEMBERSHIP_REQUIRED',
      });
    }
  }
}
