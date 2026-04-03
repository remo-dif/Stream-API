import Anthropic from "@anthropic-ai/sdk";
import {
  Injectable,
  Logger,
  RequestTimeoutException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SupabaseService } from "../supabase/supabase.service";

const AI_TIMEOUT_MS = 60_000;
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
      system:
        "You are a helpful AI assistant. Be concise, accurate, and professional.",
      messages: options.messages,
    });
  }

  /**
   * Non-streaming completion for background job processors.
   * Includes a hard timeout so jobs never hang indefinitely.
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
          system:
            "You are a helpful AI assistant. Be concise, accurate, and professional.",
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
   * Persists token usage and atomically increments the tenant quota counter.
   *
   * The RPC now raises a Postgres exception if the quota would be exceeded.
   * We detect and re-throw it as a proper HTTP 429 so the SSE error event
   * contains a meaningful code the frontend can act on.
   *
   * Non-quota errors are still swallowed (logged only) so usage logging
   * never breaks the chat flow for transient DB issues.
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

        // FIX: RPC now enforces quota atomically.
        // If quota is exceeded it raises QUOTA_EXCEEDED — we rethrow as 429.
        this.supabaseService.getAdminClient().rpc("increment_tenant_tokens", {
          p_tenant_id: data.tenantId,
          p_tokens: data.totalTokens,
        }),
      ]);

      if (logResult.error) {
        this.logger.error("Failed to insert usage_log", logResult.error);
      }

      if (quotaResult.error) {
        const msg: string = quotaResult.error.message ?? "";
        if (msg.includes("QUOTA_EXCEEDED")) {
          throw new HttpException(
            {
              error: "Token quota exceeded for this billing period",
              code: "QUOTA_EXCEEDED",
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        this.logger.error(
          "Failed to increment tenant tokens_used",
          quotaResult.error,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error("logUsage threw unexpectedly", err);
    }
  }
}
