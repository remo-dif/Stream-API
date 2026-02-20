import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { AIService } from './ai.service';

@Module({
  controllers: [ChatController],
  providers: [ChatService, AIService],
  exports: [AIService],
})
export class ChatModule {}
