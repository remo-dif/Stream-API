import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import {
  AuthUser,
  CurrentUser,
  TenantId,
} from '../common/decorators/auth.decorators';
import { QuotaGuard } from '../common/guards/quota.guard';
import { AIService } from './ai.service';
import { ChatService } from './chat.service';
import { CreateConversationDto, SendMessageDto } from './dto/chat.dto';

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

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Get a single conversation for the current user' })
  async getConversation(
    @CurrentUser() user: AuthUser,
    @TenantId() tenantId: string,
    @Param('id') conversationId: string,
  ) {
    return this.chatService.getConversation(conversationId, user.id, tenantId);
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

  @Delete('conversations/:id')
  @ApiOperation({ summary: 'Archive a conversation' })
  async deleteConversation(
    @CurrentUser() user: AuthUser,
    @TenantId() tenantId: string,
    @Param('id') conversationId: string,
  ) {
    return this.chatService.archiveConversation(
      conversationId,
      user.id,
      tenantId,
    );
  }

  @Post('conversations/:id/messages')
  @UseGuards(QuotaGuard)
  @ApiOperation({ summary: 'Send a message and stream the AI response (SSE)' })
  async sendMessage(
    @CurrentUser() user: AuthUser,
    @TenantId() tenantId: string,
    @Param('id') conversationId: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    const conversation = await this.chatService.assertConversationOwnership(
      conversationId,
      user.id,
      tenantId,
    );

    const history = await this.chatService.getContextMessages(conversationId, 20);
    const messages = [...history, { role: 'user' as const, content: dto.content }];

    await this.chatService.saveMessage(conversationId, 'user', dto.content);

    const stream = await this.aiService.streamChatResponse({
      messages,
      model: dto.model ?? conversation.model,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
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

    res.on('close', () => {
      if (!stream.ended) {
        stream.abort();
      }
    });

    try {
      for await (const event of stream) {
        const text = event.text;
        assistantContent += text;
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      }

      const finalMessage = await stream.finalResponse();
      inputTokens = finalMessage.inputTokens;
      outputTokens = finalMessage.outputTokens;

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
          model: finalMessage.model,
        }),
      ]);

      end();
    } catch (err: any) {
      this.logger.error(`Stream error for conversation ${conversationId}`, err);
      end(err);
    }
  }
}
