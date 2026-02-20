import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Response } from 'express';
import { Conversation, Message, MessageRole } from '../database/entities/conversation.entity';
import { AIService } from './ai.service';
import { SendMessageDto } from './dto/chat.dto';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Conversation)
    private conversationRepository: Repository<Conversation>,
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    private aiService: AIService,
  ) {}

  async createConversation(userId: string, tenantId: string, title?: string) {
    const conversation = this.conversationRepository.create({
      userId,
      tenantId,
      title: title || 'New conversation',
    });
    return this.conversationRepository.save(conversation);
  }

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
