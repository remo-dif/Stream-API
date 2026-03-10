import Anthropic from "@anthropic-ai/sdk";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SupabaseService } from "../supabase/supabase.service";

@Injectable()
export class AIService {
  private anthropic: Anthropic;

  constructor(
    private supabaseService: SupabaseService, // Replace repositories with Supabase
    private configService: ConfigService,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.configService.get<string>("ANTHROPIC_API_KEY"),
    });
  }

  async streamChatResponse(options: {
    conversationId: string | null;
    userId: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }) {
    return this.anthropic.messages.stream({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      messages: options.messages,
    });
  }

  async logUsage(data: {
    userId: string;
    conversationId: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }) {
    const { error } = await this.supabaseService
      .getClient()
      .from("usage_logs")
      .insert({
        user_id: data.userId,
        conversation_id: data.conversationId,
        input_tokens: data.inputTokens,
        output_tokens: data.outputTokens,
        total_tokens: data.totalTokens,
        model: "claude-3-5-sonnet-20241022",
      });

    if (error) throw error;
  }
}
