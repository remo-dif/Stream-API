import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import { AIJobProcessor } from './ai-job.processor';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'ai-processing',
    }),
    ChatModule,
  ],
  providers: [QueueService, AIJobProcessor],
  exports: [QueueService],
})
export class QueueModule {}
