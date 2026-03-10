import { Module } from "@nestjs/common";
import { AIService } from "./ai.service";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";

@Module({
  controllers: [ChatController],
  providers: [ChatService, AIService],
  exports: [AIService],
})
export class ChatModule {}
