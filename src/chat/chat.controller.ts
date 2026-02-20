import { Controller, Post, Get, Body, Param, UseGuards, Req, Res, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { QuotaGuard } from '../common/guards/quota.guard';
import { CurrentUser, TenantId } from '../common/decorators/auth.decorators';
import { ChatService } from './chat.service';
import { CreateConversationDto, SendMessageDto } from './dto/chat.dto';
import { RequestUser } from '../auth/jwt.strategy';

@ApiTags('chat')
@Controller('api/v1/chat')
@UseGuards(JwtAuthGuard, QuotaGuard)
@ApiBearerAuth()
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Post('conversations')
  @ApiOperation({ summary: 'Create new conversation' })
  @ApiResponse({ status: 201, description: 'Conversation created' })
  async createConversation(
    @Body() dto: CreateConversationDto,
    @CurrentUser() user: RequestUser,
    @TenantId() tenantId: string,
  ) {
    return this.chatService.createConversation(user.id, tenantId, dto.title);
  }

  @Get('conversations')
  @ApiOperation({ summary: 'List user conversations' })
  @ApiResponse({ status: 200, description: 'Conversations list' })
  async listConversations(
    @CurrentUser() user: RequestUser,
    @TenantId() tenantId: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    return this.chatService.listConversations(user.id, tenantId, page, limit);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Get conversation messages' })
  @ApiResponse({ status: 200, description: 'Messages list' })
  async getMessages(@Param('id') conversationId: string, @CurrentUser() user: RequestUser) {
    return this.chatService.getMessages(conversationId, user.id);
  }

  @Post('conversations/:id/messages')
  @ApiOperation({ summary: 'Send message (supports SSE streaming)' })
  @ApiResponse({ status: 200, description: 'Message sent' })
  async sendMessage(
    @Param('id') conversationId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: RequestUser,
    @TenantId() tenantId: string,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const wantsStream = req.headers.accept === 'text/event-stream';
    return this.chatService.sendMessage(conversationId, user.id, tenantId, dto, wantsStream ? res : null);
  }
}
