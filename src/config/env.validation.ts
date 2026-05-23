import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  validateSync,
} from 'class-validator';
import { DEFAULT_MODEL_BY_PROVIDER, LlmProvider } from '../chat/llm.constants';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @IsOptional()
  @Min(1)
  PORT: number = 3000;

  @IsString()
  SUPABASE_URL!: string;

  @IsString()
  SUPABASE_ANON_KEY!: string;

  @IsString()
  SUPABASE_SERVICE_ROLE_KEY!: string;

  @IsEnum(LlmProvider)
  @IsOptional()
  LLM_PROVIDER: LlmProvider = LlmProvider.OPENAI;

  @IsString()
  @IsOptional()
  OPENAI_API_KEY?: string;

  @IsString()
  @IsOptional()
  OPENAI_MODEL: string = DEFAULT_MODEL_BY_PROVIDER[LlmProvider.OPENAI];

  @IsString()
  @IsOptional()
  ANTHROPIC_API_KEY?: string;

  @IsString()
  @IsOptional()
  ANTHROPIC_MODEL: string = DEFAULT_MODEL_BY_PROVIDER[LlmProvider.ANTHROPIC];

  @IsString()
  @IsOptional()
  REDIS_HOST: string = 'localhost';

  @IsInt()
  @IsOptional()
  @Min(1)
  REDIS_PORT: number = 6379;

  @IsString()
  @IsOptional()
  REDIS_URL: string = 'redis://localhost:6379';

  @IsString()
  @IsOptional()
  ALLOWED_ORIGINS: string = 'http://localhost:3001';
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const messages = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('; ');
    throw new Error(`Configuration validation failed: ${messages}`);
  }

  if (
    validatedConfig.LLM_PROVIDER === LlmProvider.OPENAI &&
    !validatedConfig.OPENAI_API_KEY
  ) {
    throw new Error(
      'Configuration validation failed: OPENAI_API_KEY is required when LLM_PROVIDER=openai',
    );
  }

  if (
    validatedConfig.LLM_PROVIDER === LlmProvider.ANTHROPIC &&
    !validatedConfig.ANTHROPIC_API_KEY
  ) {
    throw new Error(
      'Configuration validation failed: ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic',
    );
  }

  return validatedConfig;
}
