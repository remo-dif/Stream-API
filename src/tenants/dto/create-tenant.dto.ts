import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export enum TenantPlan {
  STARTER = 'starter',
  PRO = 'pro',
  ENTERPRISE = 'enterprise',
}

export class CreateTenantDto {
  @ApiProperty({ example: 'Acme Corp' })
  @IsString()
  @MaxLength(255)
  name!: string;

  @ApiProperty({ enum: TenantPlan, default: TenantPlan.STARTER, required: false })
  @IsEnum(TenantPlan)
  @IsOptional()
  plan?: TenantPlan;

  @ApiProperty({ required: false, default: 1_000_000, minimum: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  tokenQuota?: number;
}
