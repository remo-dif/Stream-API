import Anthropic from "@anthropic-ai/sdk";
import { Injectable, Logger, RequestTimeoutException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SupabaseService } from "../supabase/supabase.service";

const AI_TIMEOUT_MS = 60_000; // 60 s hard ceiling on any AI call
const DEFAULT_MODEL = "claude-3-5-sonnet-20241022";

export type ChatMessage = { role: "user" | "assistant"; content: string };

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private readonly anthropic: Anthropic;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.configService.getOrThrow<string>("ANTHROPIC_API_KEY"),
    });
  }

  /**
   * Returns an Anthropic message stream for SSE/streaming endpoints.
   * The caller owns the stream lifecycle and must call abort() on client disconnect.
   */
  streamChatResponse(options: {
    messages: ChatMessage[];
    model?: string;
  }): ReturnType<Anthropic["messages"]["stream"]> {
    return this.anthropic.messages.stream({
      model: options.model ?? DEFAULT_MODEL,
      max_tokens: 4096,
      messages: options.messages,
    });
  }

  /**
   * Non-streaming completion for background job processors.
   * Includes a hard timeout so jobs never hang indefinitely.
   * Returns the full text plus usage stats for logging.
   */
  async createCompletion(options: {
    messages: ChatMessage[];
    model?: string;
  }): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
      const response = await this.anthropic.messages.create(
        {
          model: options.model ?? DEFAULT_MODEL,
          max_tokens: 4096,
          messages: options.messages,
        },
        { signal: controller.signal as any },
      );

      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as Anthropic.TextBlock).text)
        .join("");

      return {
        text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new RequestTimeoutException(
          `AI completion timed out after ${AI_TIMEOUT_MS / 1000}s`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Persists token usage and increments the tenant's running quota counter.
   * Errors are logged but never thrown — usage logging must never break the chat flow.
   */
  async logUsage(data: {
    userId: string;
    tenantId: string;
    conversationId?: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    model?: string;
  }): Promise<void> {
    try {
      const [logResult, quotaResult] = await Promise.all([
        this.supabaseService
          .getAdminClient()
          .from("usage_logs")
          .insert({
            user_id: data.userId,
            tenant_id: data.tenantId,
            conversation_id: data.conversationId ?? null,
            input_tokens: data.inputTokens,
            output_tokens: data.outputTokens,
            total_tokens: data.totalTokens,
            model: data.model ?? DEFAULT_MODEL,
          }),

        // Atomically increment tokens_used on the tenant row.
        // This is what QuotaGuard reads to enforce limits.
        this.supabaseService.getAdminClient().rpc("increment_tenant_tokens", {
          p_tenant_id: data.tenantId,
          p_tokens: data.totalTokens,
        }),
      ]);

      if (logResult.error) {
        this.logger.error("Failed to insert usage_log", logResult.error);
      }
      if (quotaResult.error) {
        this.logger.error(
          "Failed to increment tenant tokens_used",
          quotaResult.error,
        );
      }
    } catch (err) {
      this.logger.error("logUsage threw unexpectedly", err);
    }
  }
}
