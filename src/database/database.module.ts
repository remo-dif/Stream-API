import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Tenant } from './entities/tenant.entity';
import { Conversation, Message } from './entities/conversation.entity';
import { UsageLog, AsyncJob } from './entities/usage-log.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Tenant,
      Conversation,
      Message,
      UsageLog,
      AsyncJob,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
