import {
  Controller,
  Post,
  Get,
  UseGuards,
  Param,
  Body,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { ChatService } from './chat.service';
import { AIService } from './ai.service';
import { CreateConversationDto, SendMessageDto } from './dto/chat.dto';
import {
  CurrentUser,
  TenantId,
  AuthUser,
} from '../common/decorators/auth.decorators';

@ApiTags('chat')
@Controller('api/v1/chat')
@UseGuards(SupabaseAuthGuard)
@ApiBearerAuth()
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly aiService: AIService,
  ) {}

  @Get('conversations')
  @ApiOperation({ summary: 'List conversations for the current user' })
  async getConversations(
    @CurrentUser() user: AuthUser,
    @TenantId() tenantId: string,
  ) {
    return this.chatService.getConversations(user.id, tenantId);
  }

  @Post('conversations')
  @ApiOperation({ summary: 'Create a new conversation' })
  async createConversation(
    @CurrentUser() user: AuthUser,
    @TenantId() tenantId: string,
    @Body() dto: CreateConversationDto,
  ) {
    return this.chatService.createConversation(
      user.id,
      tenantId,
      dto.title ?? 'New Conversation',
    );
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Get paginated messages in a conversation' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'before', required: false, type: String })
  async getMessages(
    @CurrentUser() user: AuthUser,
    @TenantId() tenantId: string,
    @Param('id') conversationId: string,
    @Query('limit') limit: number = 50,
    @Query('before') before?: string,
  ) {
    return this.chatService.getMessages(
      conversationId,
      user.id,
      tenantId,
      Number(limit),
      before,
    );
  }

  /**
   * SSE streaming endpoint.
   *
   * Flow:
   *  1. Verify conversation ownership (throws NotFoundException before writing headers)
   *  2. Save the user's message
   *  3. Open SSE stream, forward each text delta to the client
   *  4. On client disconnect, abort the Anthropic stream immediately
   *  5. On completion, persist the assistant message + log usage atomically
   *
   * Error handling:
   *  - Errors BEFORE res.flushHeaders() propagate to NestJS exception filters normally.
   *  - Errors AFTER headers are sent are written as SSE error events then the stream ends.
   */
  @Post('conversations/:id/messages')
  @ApiOperation({ summary: 'Send a message and stream the AI response (SSE)' })
  async sendMessage(
    @CurrentUser() user: AuthUser,
    @TenantId() tenantId: string,
    @Param('id') conversationId: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    // Step 1: Verify ownership BEFORE writing any headers so errors propagate normally
    const conversation = await this.chatService.assertConversationOwnership(
      conversationId,
      user.id,
      tenantId,
    );

    // Step 2: Build context from conversation history
    const history = await this.chatService.getContextMessages(
      conversationId,
      20,
    );
    const messages = [...history, { role: 'user' as const, content: dto.content }];

    // Step 3: Persist user message before opening the stream
    await this.chatService.saveMessage(conversationId, 'user', dto.content);

    // Step 4: Open the Anthropic stream
    const stream = this.aiService.streamChatResponse({
      messages,
      model: dto.model ?? conversation.model,
    });

    // Step 5: Write SSE headers — from this point all errors go as SSE events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx response buffering
    res.flushHeaders();

    let assistantContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const end = (err?: Error) => {
      if (res.writableEnded) return;
      if (err) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`,
        );
      }
      res.write('event: done\ndata: [DONE]\n\n');
      res.end();
    };

    // Abort the upstream stream immediately when the client disconnects
    res.on('close', () => {
      if (!stream.ended) {
        stream.abort();
      }
    });

    try {
      stream.on('text', (text: string) => {
        assistantContent += text;
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      });

      // Capture final usage from the complete message event
      const finalMessage = await stream.finalMessage();
      inputTokens = finalMessage.usage.input_tokens;
      outputTokens = finalMessage.usage.output_tokens;

      // Persist assistant reply and log usage in parallel
      await Promise.all([
        this.chatService.saveMessage(
          conversationId,
          'assistant',
          assistantContent,
          inputTokens + outputTokens,
        ),
        this.aiService.logUsage({
          userId: user.id,
          tenantId,
          conversationId,
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          model: dto.model ?? conversation.model,
        }),
      ]);

      end();
    } catch (err: any) {
      this.logger.error(`Stream error for conversation ${conversationId}`, err);
      end(err);
    }
  }
}
