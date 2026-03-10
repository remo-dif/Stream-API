import { Controller, Post, Get, UseGuards, Req, Param, Body } from '@nestjs/common';
import { Request } from 'express';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { ChatService } from './chat.service';

@Controller('api/v1/chat')
@UseGuards(SupabaseAuthGuard)
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Get('conversations')
  async getConversations(@Req() req: Request & { user: any }) {
    const userId = req.user.id;
    return this.chatService.getConversations(userId);
  }

  @Post('conversations')
  async createConversation(@Req() req: Request & { user: any }, @Body() body: { title?: string }) {
    const userId = req.user.id;
    return this.chatService.createConversation(userId, body.title || 'New Conversation');
  }

  @Get('conversations/:id/messages')
  async getMessages(@Req() req: Request & { user: any }, @Param('id') conversationId: string) {
    const userId = req.user.id;
    return this.chatService.getMessages(conversationId, userId);
  }
}