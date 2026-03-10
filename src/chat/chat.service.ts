import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class ChatService {
  constructor(private supabaseService: SupabaseService) {}

  async getConversations(userId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  async createConversation(userId: string, title: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('conversations')
      .insert({
        user_id: userId,
        title,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getMessages(conversationId: string, userId: string) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data;
  }

  async saveMessage(conversationId: string, role: string, content: string, tokens?: number) {
    const { data, error } = await this.supabaseService
      .getClient()
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role,
        content,
        tokens,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}
