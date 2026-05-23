import Anthropic from '@anthropic-ai/sdk';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  RequestTimeoutException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { SupabaseService } from '../supabase/supabase.service';
import {
  DEFAULT_MODEL_BY_PROVIDER,
  inferProviderFromModel,
  LlmProvider,
  SYSTEM_PROMPT,
} from './llm.constants';
import {
  AITextStream,
  ChatMessage,
  CompletionResult,
  StreamFinalResponse,
  StreamTextDelta,
} from './llm.types';

const AI_TIMEOUT_MS = 60_000;

type ResolvedProvider = {
  provider: LlmProvider;
  model: string;
};

class AnthropicTextStream implements AITextStream {
  ended = false;

  constructor(
    private readonly stream: ReturnType<Anthropic['messages']['stream']>,
    private readonly model: string,
  ) {}

  abort(): void {
    this.ended = true;
    this.stream.abort();
  }

  async finalResponse(): Promise<StreamFinalResponse> {
    const finalMessage = await this.stream.finalMessage();
    this.ended = true;

    return {
      inputTokens: finalMessage.usage?.input_tokens ?? 0,
      outputTokens: finalMessage.usage?.output_tokens ?? 0,
      model: this.model,
    };
  }

  async *[Symbol.asyncIterator](): AsyncIterator<StreamTextDelta> {
    for await (const event of this.stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield { text: event.delta.text };
      }
    }

    this.ended = true;
  }
}

class OpenAITextStream implements AITextStream {
  ended = false;
  private usage:
    | { prompt_tokens?: number; completion_tokens?: number }
    | undefined;
  private resolvedModel: string;

  constructor(
    private readonly stream: Awaited<
      ReturnType<OpenAI['chat']['completions']['create']>
    >,
    private readonly controller: AbortController,
    model: string,
  ) {
    this.resolvedModel = model;
  }

  abort(): void {
    this.ended = true;
    this.controller.abort();
  }

  async finalResponse(): Promise<StreamFinalResponse> {
    this.ended = true;

    return {
      inputTokens: this.usage?.prompt_tokens ?? 0,
      outputTokens: this.usage?.completion_tokens ?? 0,
      model: this.resolvedModel,
    };
  }

  async *[Symbol.asyncIterator](): AsyncIterator<StreamTextDelta> {
    for await (const chunk of this.stream as AsyncIterable<any>) {
      if (chunk.model) {
        this.resolvedModel = chunk.model;
      }

      if (chunk.usage) {
        this.usage = chunk.usage;
      }

      const text = chunk.choices?.[0]?.delta?.content;
      if (typeof text === 'string' && text.length > 0) {
        yield { text };
      }
    }

    this.ended = true;
  }
}

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private readonly anthropic?: Anthropic;
  private readonly openai?: OpenAI;
  private readonly defaultProvider: LlmProvider;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    this.defaultProvider = this.configService.get<LlmProvider>(
      'LLM_PROVIDER',
      LlmProvider.OPENAI,
    );

    const anthropicApiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    const openaiApiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (anthropicApiKey) {
      this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
    }

    if (openaiApiKey) {
      this.openai = new OpenAI({ apiKey: openaiApiKey });
    }
  }

  getDefaultModel(): string {
    return this.getDefaultModelForProvider(this.defaultProvider);
  }

  async streamChatResponse(options: {
    messages: ChatMessage[];
    model?: string;
  }): Promise<AITextStream> {
    const resolved = this.resolveProvider(options.model);

    if (resolved.provider === LlmProvider.ANTHROPIC) {
      const stream = this.getAnthropicClient().messages.stream({
        model: resolved.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: options.messages,
      });

      return new AnthropicTextStream(stream, resolved.model);
    }

    const controller = new AbortController();
    const stream = await this.getOpenAIClient().chat.completions.create(
      {
        model: resolved.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...options.messages,
        ],
        max_completion_tokens: 4096,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: controller.signal },
    );

    return new OpenAITextStream(stream, controller, resolved.model);
  }

  async createCompletion(options: {
    messages: ChatMessage[];
    model?: string;
  }): Promise<CompletionResult> {
    const resolved = this.resolveProvider(options.model);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
      if (resolved.provider === LlmProvider.ANTHROPIC) {
        const response = await this.getAnthropicClient().messages.create(
          {
            model: resolved.model,
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            messages: options.messages,
          },
          { signal: controller.signal as any },
        );

        const text = response.content
          .filter((block) => block.type === 'text')
          .map((block) => (block as Anthropic.TextBlock).text)
          .join('');

        return {
          text,
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          model: resolved.model,
        };
      }

      const response = await this.getOpenAIClient().chat.completions.create(
        {
          model: resolved.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...options.messages,
          ],
          max_completion_tokens: 4096,
        },
        { signal: controller.signal },
      );

      return {
        text: this.extractOpenAIText(response.choices?.[0]?.message?.content),
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        model: response.model ?? resolved.model,
      };
    } catch (error: unknown) {
      if (this.isAbortError(error)) {
        throw new RequestTimeoutException(
          `AI completion timed out after ${AI_TIMEOUT_MS / 1000}s`,
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

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
          .from('usage_logs')
          .insert({
            user_id: data.userId,
            tenant_id: data.tenantId,
            conversation_id: data.conversationId ?? null,
            input_tokens: data.inputTokens,
            output_tokens: data.outputTokens,
            total_tokens: data.totalTokens,
            model: data.model ?? this.getDefaultModel(),
          }),

        this.supabaseService.getAdminClient().rpc('increment_tenant_tokens', {
          p_tenant_id: data.tenantId,
          p_tokens: data.totalTokens,
        }),
      ]);

      if (logResult.error) {
        this.logger.error('Failed to insert usage_log', logResult.error);
      }

      if (quotaResult.error) {
        const message: string = quotaResult.error.message ?? '';
        if (message.includes('QUOTA_EXCEEDED')) {
          throw new HttpException(
            {
              error: 'Token quota exceeded for this billing period',
              code: 'QUOTA_EXCEEDED',
            },
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        this.logger.error(
          'Failed to increment tenant tokens_used',
          quotaResult.error,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('logUsage threw unexpectedly', error);
    }
  }

  private resolveProvider(requestedModel?: string): ResolvedProvider {
    if (requestedModel) {
      const inferredProvider = inferProviderFromModel(requestedModel);

      if (!inferredProvider) {
        throw new BadRequestException(
          `Unsupported model "${requestedModel}"`,
        );
      }

      this.assertProviderConfigured(inferredProvider, requestedModel);
      return { provider: inferredProvider, model: requestedModel };
    }

    const model = this.getDefaultModelForProvider(this.defaultProvider);
    this.assertProviderConfigured(this.defaultProvider, model);

    return { provider: this.defaultProvider, model };
  }

  private getDefaultModelForProvider(provider: LlmProvider): string {
    if (provider === LlmProvider.OPENAI) {
      return this.configService.get<string>(
        'OPENAI_MODEL',
        DEFAULT_MODEL_BY_PROVIDER[LlmProvider.OPENAI],
      );
    }

    return this.configService.get<string>(
      'ANTHROPIC_MODEL',
      DEFAULT_MODEL_BY_PROVIDER[LlmProvider.ANTHROPIC],
    );
  }

  private assertProviderConfigured(
    provider: LlmProvider,
    model: string,
  ): void {
    if (provider === LlmProvider.OPENAI && !this.openai) {
      throw new InternalServerErrorException(
        `OpenAI is not configured for model "${model}"`,
      );
    }

    if (provider === LlmProvider.ANTHROPIC && !this.anthropic) {
      throw new InternalServerErrorException(
        `Anthropic is not configured for model "${model}"`,
      );
    }
  }

  private getAnthropicClient(): Anthropic {
    if (!this.anthropic) {
      throw new InternalServerErrorException('Anthropic is not configured');
    }

    return this.anthropic;
  }

  private getOpenAIClient(): OpenAI {
    if (!this.openai) {
      throw new InternalServerErrorException('OpenAI is not configured');
    }

    return this.openai;
  }

  private extractOpenAIText(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((part: any) => (part?.type === 'text' ? part.text : ''))
        .join('');
    }

    return '';
  }

  private isAbortError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return (
      error.name === 'AbortError' ||
      error.name === 'APIUserAbortError' ||
      error.message.toLowerCase().includes('aborted')
    );
  }
}
