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

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private client: Anthropic;
  private redis: Redis;

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

  private calcDelay(attempt: number): number {
    const base = Math.min(
      RETRY_CONFIG.baseDelay * Math.pow(2, attempt),
      RETRY_CONFIG.maxDelay,
    );
    return base + Math.random() * 1000;
  }

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
        // Check cache
        const cacheKey = `cache:chat:${Buffer.from(JSON.stringify(messages)).toString("base64").slice(0, 64)}`;
        const cached = await this.redis.get(cacheKey);

        if (cached && !res) {
          this.logger.log(`Cache hit for conversation ${conversationId}`);
          return JSON.parse(cached);
        }

        // Set up SSE if response object provided
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

        const stream = this.client.messages.stream({
          model,
          max_tokens: maxTokens,
          system: `You are a helpful AI assistant. Current timestamp: ${new Date().toISOString()}`,
          messages: messages as any,
        });

        stream.on("text", (text: string) => {
          fullContent += text;
          if (res) {
            res.write(
              `data: ${JSON.stringify({ type: "delta", content: text })}\n\n`,
            );
          }
        });

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

        // Track usage asynchronously
        this.trackUsage({
          userId,
          tenantId,
          conversationId,
          model,
          usage,
        }).catch((err) => this.logger.error("Usage tracking failed", err));

        // Cache short responses
        if (outputTokens < 500) {
          await this.redis.setex(
            cacheKey,
            300,
            JSON.stringify({ content: fullContent, usage }),
          );
        }

        if (res) {
          res.write(`data: ${JSON.stringify({ type: "done", usage })}\n\n`);
          res.end();
        }

        return { content: fullContent, usage };
      } catch (err: any) {
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

          if (res) {
            res.write(
              `data: ${JSON.stringify({ type: "retrying", attempt, delay })}\n\n`,
            );
          }

          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // Handle specific errors
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

  async complete(
    options: Omit<StreamOptions, "res">,
  ): Promise<CompletionResult> {
    return this.streamChatResponse({ ...options, res: undefined });
  }

  private async trackUsage(params: {
    userId: string;
    tenantId: string;
    conversationId: string | null;
    model: string;
    usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  }): Promise<void> {
    const { userId, tenantId, conversationId, model, usage } = params;

    // Save to database
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

    // Update tenant token counter
    await this.tenantRepository.increment(
      { id: tenantId },
      "tokensUsed",
      usage.totalTokens,
    );

    // Update Redis counter for real-time dashboard
    const today = new Date().toISOString().split("T")[0];
    await this.redis.incrby(`usage:${tenantId}:${today}`, usage.totalTokens);
    await this.redis.expire(`usage:${tenantId}:${today}`, 86400 * 7);
  }
}
