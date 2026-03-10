import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength, MinLength, IsIn } from 'class-validator';

export const ALLOWED_MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229',
  'claude-3-haiku-20240307',
] as const;

export class CreateConversationDto {
  @ApiProperty({ example: 'My AI Conversation', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  title?: string;
}

export class SendMessageDto {
  @ApiProperty({ example: 'What is the capital of France?' })
  @IsString()
  @MinLength(1)
  @MaxLength(32000)
  content: string;

  @ApiProperty({ example: 'claude-3-5-sonnet-20241022', required: false, enum: ALLOWED_MODELS })
  @IsOptional()
  @IsIn(ALLOWED_MODELS)
  model?: string;
}

export class ConversationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty()
  messageCount: number;
}

export class MessageResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ['user', 'assistant', 'system'] })
  role: string;

  @ApiProperty()
  content: string;

  @ApiProperty({ nullable: true })
  tokens: number | null;

  @ApiProperty()
  createdAt: Date;
}
