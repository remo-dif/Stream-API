import { Controller, Post, Get, Body, Param, UseGuards, Req, Res, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { QuotaGuard } from '../common/guards/quota.guard';
import { CurrentUser, TenantId } from '../common/decorators/auth.decorators';
import { ChatService } from './chat.service';
import { CreateConversationDto, SendMessageDto } from './dto/chat.dto';
import { RequestUser } from '../auth/jwt.strategy';

/**
 * Chat Controller
 *
 * Handles all chat-related HTTP endpoints for the AI SaaS application.
 * Provides functionality for managing conversations and sending/receiving messages
 * with support for Server-Sent Events (SSE) streaming.
 *
 * @ApiTags chat - Swagger documentation tag for grouping chat endpoints
 * @Controller api/v1/chat - Base route for all chat endpoints
 * @UseGuards JwtAuthGuard, QuotaGuard - Requires authentication and checks usage quotas
 * @ApiBearerAuth - Requires Bearer token authentication for Swagger docs
 */
@ApiTags('chat')
@Controller('api/v1/chat')
@UseGuards(JwtAuthGuard, QuotaGuard)
@ApiBearerAuth()
export class ChatController {
  /**
   * Constructor - Injects the ChatService dependency
   * @param chatService - Service handling chat business logic
   */
  constructor(private chatService: ChatService) {}

  /**
   * Create a new conversation
   *
   * Creates a new conversation thread for the authenticated user within their tenant.
   * This is the starting point for any chat interaction.
   *
   * @param dto - Data transfer object containing conversation details (title)
   * @param user - Currently authenticated user information
   * @param tenantId - Tenant identifier for multi-tenancy support
   * @returns Promise<Conversation> - The created conversation object
   */
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

  /**
   * List user conversations
   *
   * Retrieves a paginated list of conversations belonging to the authenticated user
   * within their tenant. Supports pagination for performance.
   *
   * @param user - Currently authenticated user information
   * @param tenantId - Tenant identifier for multi-tenancy support
   * @param page - Page number for pagination (default: 1)
   * @param limit - Number of conversations per page (default: 20)
   * @returns Promise<{conversations: Conversation[], total: number, page: number, limit: number}>
   */
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

  /**
   * Get conversation messages
   *
   * Retrieves all messages within a specific conversation. Only accessible
   * by the conversation owner.
   *
   * @param conversationId - Unique identifier of the conversation
   * @param user - Currently authenticated user (for authorization)
   * @returns Promise<Message[]> - Array of messages in the conversation
   */
  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Get conversation messages' })
  @ApiResponse({ status: 200, description: 'Messages list' })
  async getMessages(@Param('id') conversationId: string, @CurrentUser() user: RequestUser) {
    return this.chatService.getMessages(conversationId, user.id);
  }

  /**
   * Send message to conversation
   *
   * Sends a new message to an existing conversation. Supports both regular HTTP responses
   * and Server-Sent Events (SSE) streaming for real-time AI responses.
   *
   * When the client accepts 'text/event-stream', the response is streamed in real-time.
   * Otherwise, returns the complete response after processing.
   *
   * @param conversationId - Unique identifier of the target conversation
   * @param dto - Message content and metadata
   * @param user - Currently authenticated user information
   * @param tenantId - Tenant identifier for multi-tenancy support
   * @param req - Express request object (to check Accept header)
   * @param res - Express response object (for SSE streaming)
   * @returns Promise<Message | void> - Message object or void (when streaming)
   */
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
