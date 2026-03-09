import Anthropic from "@anthropic-ai/sdk";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Response } from "express";
import Redis from "ioredis";
import { Repository } from "typeorm";
import { Tenant } from "../database/entities/tenant.entity";
import { UsageLog } from "../database/entities/usage-log.entity";

interface StreamOptions {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  maxTokens?: number;
  userId: string;
  tenantId: string;
  conversationId: string | null;
  res?: Response;
}

interface CompletionResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  retryableErrors: ["overloaded_error", "api_error", "timeout"],
};

/**
 * AI Service
 *
 * Core service for integrating with Anthropic's Claude AI models in the SaaS application.
 * Handles chat completions with support for both streaming and non-streaming responses,
 * implements caching for performance, retry logic for reliability, and comprehensive
 * usage tracking for billing and analytics. Uses Redis for caching and real-time metrics.
 */
@Injectable()
export class AIService {
  /** Logger instance for AI service operations and errors */
  private readonly logger = new Logger(AIService.name);

  /** Anthropic API client for AI model interactions */
  private client: Anthropic;

  /** Redis client for caching and real-time usage tracking */
  private redis: Redis;

  /**
   * Constructor - Initializes Anthropic client and Redis connection
   * @param usageLogRepository - TypeORM repository for usage logging
   * @param tenantRepository - TypeORM repository for tenant operations
   * @param configService - Configuration service for API keys and settings
   */
  constructor(
    @InjectRepository(UsageLog)
    private usageLogRepository: Repository<UsageLog>,
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
    private configService: ConfigService,
  ) {
    this.client = new Anthropic({
      apiKey: configService.get<string>("ANTHROPIC_API_KEY"),
    });
    this.redis = new Redis(
      configService.get<string>("REDIS_URL") || "redis://localhost:6379",
    );
  }

  /**
   * Calculate exponential backoff delay for retries
   * @param attempt - Current retry attempt number (0-based)
   * @returns Delay in milliseconds with jitter
   */
  private calcDelay(attempt: number): number {
    const base = Math.min(
      RETRY_CONFIG.baseDelay * Math.pow(2, attempt),
      RETRY_CONFIG.maxDelay,
    );
    return base + Math.random() * 1000;
  }

  /**
   * Stream chat response from AI model
   *
   * Main method for generating AI responses with support for Server-Sent Events streaming.
   * Implements caching, retry logic, usage tracking, and error handling.
   * Can operate in both streaming and non-streaming modes based on response object presence.
   *
   * @param options - Streaming options including messages, model, and user context
   * @returns Promise<CompletionResult> - AI response content and token usage statistics
   */
  async streamChatResponse(options: StreamOptions): Promise<CompletionResult> {
    const {
      messages,
      model = "claude-3-5-sonnet-20241022",
      maxTokens = 2048,
      userId,
      tenantId,
      conversationId,
      res,
    } = options;

    let attempt = 0;

    while (attempt <= RETRY_CONFIG.maxRetries) {
      try {
        // Check cache for non-streaming requests
        const cacheKey = `cache:chat:${Buffer.from(JSON.stringify(messages)).toString("base64").slice(0, 64)}`;
        const cached = await this.redis.get(cacheKey);

        if (cached && !res) {
          this.logger.log(`Cache hit for conversation ${conversationId}`);
          return JSON.parse(cached);
        }

        // Configure Server-Sent Events headers for streaming
        if (res) {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");
          res.setHeader("X-Accel-Buffering", "no");
          res.flushHeaders();
        }

        let fullContent = "";
        let inputTokens = 0;
        let outputTokens = 0;

        // Initialize Anthropic streaming
        const stream = this.client.messages.stream({
          model,
          max_tokens: maxTokens,
          system: `You are a helpful AI assistant. Current timestamp: ${new Date().toISOString()}`,
          messages: messages as any,
        });

        // Handle streaming text chunks
        stream.on("text", (text: string) => {
          fullContent += text;
          if (res) {
            res.write(
              `data: ${JSON.stringify({ type: "delta", content: text })}\n\n`,
            );
          }
        });

        // Capture token usage from final message
        stream.on("message", (msg: any) => {
          inputTokens = msg.usage?.input_tokens || 0;
          outputTokens = msg.usage?.output_tokens || 0;
        });

        await stream.finalMessage();

        const usage = {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        };

        // Track usage asynchronously (don't block response)
        this.trackUsage({
          userId,
          tenantId,
          conversationId,
          model,
          usage,
        }).catch((err) => this.logger.error("Usage tracking failed", err));

        // Cache short responses for 5 minutes
        if (outputTokens < 500) {
          await this.redis.setex(
            cacheKey,
            300,
            JSON.stringify({ content: fullContent, usage }),
          );
        }

        // Send completion event for streaming responses
        if (res) {
          res.write(`data: ${JSON.stringify({ type: "done", usage })}\n\n`);
          res.end();
        }

        return { content: fullContent, usage };
      } catch (err: any) {
        // Determine if error is retryable
        const isRetryable =
          err.status === 529 ||
          err.status >= 500 ||
          RETRY_CONFIG.retryableErrors.some((e) => err.message?.includes(e));

        if (isRetryable && attempt < RETRY_CONFIG.maxRetries) {
          attempt++;
          const delay = this.calcDelay(attempt);
          this.logger.warn(
            `AI API error (attempt ${attempt}/${RETRY_CONFIG.maxRetries}), retrying in ${delay}ms: ${err.message}`,
          );

          // Notify client of retry for streaming responses
          if (res) {
            res.write(
              `data: ${JSON.stringify({ type: "retrying", attempt, delay })}\n\n`,
            );
          }

          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // Handle rate limiting specifically
        if (err.status === 429) {
          const retryAfter = parseInt(err.headers?.["retry-after"] || "60");
          if (res) {
            res.write(
              `data: ${JSON.stringify({ type: "error", code: "RATE_LIMITED", retryAfter })}\n\n`,
            );
            res.end();
          }
          throw new Error("AI API rate limit exceeded");
        }

        // Log permanent failure and notify client
        this.logger.error(`AI stream failed permanently: ${err.message}`);
        if (res) {
          res.write(
            `data: ${JSON.stringify({ type: "error", message: "AI service unavailable" })}\n\n`,
          );
          res.end();
        }
        throw err;
      }
    }

    throw new Error("Max retries exceeded");
  }

  /**
   * Generate non-streaming AI completion
   *
   * Convenience method for non-streaming completions that internally calls streamChatResponse
   * without a response object, ensuring consistent behavior and caching.
   *
   * @param options - Completion options (same as StreamOptions but without res)
   * @returns Promise<CompletionResult> - AI response content and usage statistics
   */
  async complete(
    options: Omit<StreamOptions, "res">,
  ): Promise<CompletionResult> {
    return this.streamChatResponse({ ...options, res: undefined });
  }

  /**
   * Track AI usage for billing and analytics
   *
   * Records token consumption in the database and updates real-time counters.
   * Updates tenant's total token usage and maintains daily usage metrics in Redis.
   * Runs asynchronously to avoid blocking AI response delivery.
   *
   * @param params - Usage tracking parameters including user, tenant, and token counts
   * @returns Promise<void>
   */
  private async trackUsage(params: {
    userId: string;
    tenantId: string;
    conversationId: string | null;
    model: string;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  }): Promise<void> {
    const { userId, tenantId, conversationId, model, usage } = params;

    // Persist usage log to database
    const log = this.usageLogRepository.create({
      userId,
      tenantId,
      conversationId,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    });

    await this.usageLogRepository.save(log);

    // Update tenant's running token total
    await this.tenantRepository.increment(
      { id: tenantId },
      "tokensUsed",
      usage.totalTokens,
    );

    // Update Redis counter for real-time dashboard (expires after 7 days)
    const today = new Date().toISOString().split("T")[0];
    await this.redis.incrby(`usage:${tenantId}:${today}`, usage.totalTokens);
    await this.redis.expire(`usage:${tenantId}:${today}`, 86400 * 7);
  }
}
