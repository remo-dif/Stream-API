import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Response } from 'express';
import { Conversation, Message, MessageRole } from '../database/entities/conversation.entity';
import { AIService } from './ai.service';
import { SendMessageDto } from './dto/chat.dto';

/**
 * Chat Service
 *
 * Core service for managing AI chat conversations and messages in the SaaS application.
 * Handles conversation lifecycle, message storage, and AI integration with support for
 * both streaming and non-streaming responses. Implements multi-tenant isolation and
 * usage tracking for billing purposes.
 */
@Injectable()
export class ChatService {
  /**
   * Constructor - Injects required repositories and services
   * @param conversationRepository - TypeORM repository for Conversation entity operations
   * @param messageRepository - TypeORM repository for Message entity operations
   * @param aiService - Service handling AI model interactions and streaming
   */
  constructor(
    @InjectRepository(Conversation)
    private conversationRepository: Repository<Conversation>,
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    private aiService: AIService,
  ) {}

  /**
   * Create a new conversation
   *
   * Initializes a new chat conversation for a user within their tenant.
   * Sets a default title if none provided and establishes the conversation record.
   *
   * @param userId - ID of the user creating the conversation
   * @param tenantId - Tenant identifier for multi-tenancy support
   * @param title - Optional conversation title (defaults to 'New conversation')
   * @returns Promise<Conversation> - The created conversation object
   */
  async createConversation(userId: string, tenantId: string, title?: string) {
    const conversation = this.conversationRepository.create({
      userId,
      tenantId,
      title: title || 'New conversation',
    });
    return this.conversationRepository.save(conversation);
  }

  /**
   * List user conversations with pagination
   *
   * Retrieves conversations belonging to a specific user within their tenant.
   * Includes message count for each conversation and supports pagination for performance.
   * Results are ordered by most recently updated first.
   *
   * @param userId - ID of the user whose conversations to retrieve
   * @param tenantId - Tenant identifier for multi-tenancy support
   * @param page - Page number for pagination (default: 1)
   * @param limit - Number of conversations per page (default: 20)
   * @returns Promise<{conversations: Conversation[], page: number, limit: number, total: number}>
   */
  async listConversations(userId: string, tenantId: string, page: number = 1, limit: number = 20) {
    const [conversations, total] = await this.conversationRepository.findAndCount({
      where: { userId, tenantId },
      order: { updatedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const withCounts = await Promise.all(
      conversations.map(async (conv) => ({
        ...conv,
        messageCount: await this.messageRepository.count({ where: { conversationId: conv.id } }),
      })),
    );

    return { conversations: withCounts, page, limit, total };
  }

  /**
   * Get all messages in a conversation
   *
   * Retrieves the complete message history for a specific conversation.
   * Only the conversation owner can access their messages. Messages are returned
   * in chronological order (oldest first).
   *
   * @param conversationId - Unique identifier of the conversation
   * @param userId - ID of the user requesting messages (for authorization)
   * @returns Promise<{messages: Message[]}> - Array of messages in chronological order
   * @throws NotFoundException - If conversation doesn't exist or user doesn't own it
   */
  async getMessages(conversationId: string, userId: string) {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, userId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const messages = await this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });

    return { messages };
  }

  /**
   * Send a message and get AI response
   *
   * Processes a user message, saves it to the conversation, and generates an AI response.
   * Supports both streaming (Server-Sent Events) and non-streaming responses.
   * Updates conversation timestamp and tracks token usage for billing.
   *
   * @param conversationId - ID of the conversation to send message to
   * @param userId - ID of the user sending the message
   * @param tenantId - Tenant identifier for multi-tenancy support
   * @param dto - Message content and model selection
   * @param res - Express response object for streaming (null for non-streaming)
   * @returns Promise<{message: string, usage: object} | void> - Response content and usage stats, or void for streaming
   * @throws NotFoundException - If conversation doesn't exist or user doesn't own it
   */
  async sendMessage(
    conversationId: string,
    userId: string,
    tenantId: string,
    dto: SendMessageDto,
    res: Response | null,
  ) {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, userId, tenantId },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // Save user message
    const userMessage = this.messageRepository.create({
      conversationId,
      role: MessageRole.USER,
      content: dto.content,
    });
    await this.messageRepository.save(userMessage);

    // Get conversation history
    const history = await this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      take: 20,
    });

    const messages = history.map((m) => ({ role: m.role, content: m.content }));

    if (res) {
      // Streaming response
      await this.aiService.streamChatResponse({
        messages,
        model: dto.model,
        userId,
        tenantId,
        conversationId,
        res,
      });

      // Update conversation timestamp
      await this.conversationRepository.update(conversationId, { updatedAt: new Date() });
    } else {
      // Non-streaming response
      const result = await this.aiService.streamChatResponse({
        messages,
        model: dto.model,
        userId,
        tenantId,
        conversationId,
        res: undefined,
      });

      // Save assistant message
      const assistantMessage = this.messageRepository.create({
        conversationId,
        role: MessageRole.ASSISTANT,
        content: result.content,
        tokens: result.usage.totalTokens,
      });
      await this.messageRepository.save(assistantMessage);
      await this.conversationRepository.update(conversationId, { updatedAt: new Date() });

      return { message: result.content, usage: result.usage };
    }
  }
}
