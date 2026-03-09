import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { User } from './user.entity';
import { Conversation } from './conversation.entity';

/**
 * Tenant Plan Enum
 *
 * Defines the available subscription plans for tenants in the AI SaaS application.
 * Each plan offers different token quotas and feature sets for billing purposes.
 */
export enum TenantPlan {
  /** Basic plan with limited token quota for small teams or individuals */
  STARTER = 'starter',

  /** Professional plan with higher token quota for growing teams */
  PRO = 'pro',

  /** Enterprise plan with maximum token quota and advanced features */
  ENTERPRISE = 'enterprise',
}

/**
 * Tenant Entity
 *
 * Represents an organization or company using the AI SaaS platform. Implements
 * multi-tenancy by isolating data and resources per tenant. Includes billing
 * information (plan, token quotas), settings, and relationships to users and conversations.
 * Used for access control, quota management, and billing calculations.
 */
@Entity('tenants')
export class Tenant {
  /** Unique identifier for the tenant (UUID) */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Display name of the tenant/organization */
  @Column({ length: 255 })
  name!: string;

  /** Current subscription plan determining features and token limits */
  @Column({
    type: 'enum',
    enum: TenantPlan,
    default: TenantPlan.STARTER,
  })
  plan!: TenantPlan;

  /** Maximum number of tokens allowed per billing period */
  @Column({ name: 'token_quota', type: 'bigint', default: 1000000 })
  tokenQuota!: number;

  /** Number of tokens consumed so far in the current billing period */
  @Column({ name: 'tokens_used', type: 'bigint', default: 0 })
  tokensUsed!: number;

  /** Flag indicating if the tenant account is active (can access the platform) */
  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  /** Flexible JSON storage for tenant-specific configuration and preferences */
  @Column({ type: 'jsonb', default: {} })
  settings!: Record<string, any>;

  /** Timestamp when the tenant was created */
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** Timestamp when the tenant was last updated */
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  // Relations

  /** One-to-many relationship with User (tenant has many users) */
  @OneToMany(() => User, (user) => user.tenant)
  users!: User[];

  /** One-to-many relationship with Conversation (tenant has many conversations) */
  @OneToMany(() => Conversation, (conversation) => conversation.tenant)
  conversations!: Conversation[];
}
