import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject, IsString } from 'class-validator';

const VALID_JOB_TYPES = ['summarize', 'analyze', 'translate'] as const;

export class SubmitJobDto {
  @ApiProperty({
    enum: VALID_JOB_TYPES,
    example: 'summarize',
  })
  @IsString()
  @IsIn(VALID_JOB_TYPES)
  jobType!: string;

  @ApiProperty({
    example: { text: 'Your content here', targetLang: 'Spanish' },
  })
  @IsObject()
  payload!: Record<string, any>;
}
