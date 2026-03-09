import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Tenant } from './tenant.entity';
import { Conversation } from './conversation.entity';

/**
 * Usage Log Entity
 *
 * Tracks AI model usage for billing, analytics, and quota management. Records
 * token consumption per request with user, tenant, and conversation context.
 * Used for generating usage reports, enforcing token quotas, and cost analysis.
 * Supports both real-time usage tracking and historical analytics.
 */
@Entity('usage_logs')
export class UsageLog {
  /** Unique identifier for the usage log entry (UUID) */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** ID of the user who made the request (nullable for anonymous usage) */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  /** ID of the tenant the usage belongs to (required for multi-tenancy) */
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** ID of the conversation this usage is associated with (nullable) */
  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId!: string | null;

  /** Name of the AI model used (e.g., 'claude-3-sonnet-20240229') */
  @Column({ length: 100 })
  model!: string;

  /** Number of input tokens consumed in the request */
  @Column({ name: 'input_tokens', type: 'int', default: 0 })
  inputTokens!: number;

  /** Number of output tokens generated in the response */
  @Column({ name: 'output_tokens', type: 'int', default: 0 })
  outputTokens!: number;

  /** Total tokens consumed (input + output) for billing calculations */
  @Column({ name: 'total_tokens', type: 'int', default: 0 })
  totalTokens!: number;

  /** Response latency in milliseconds (for performance monitoring) */
  @Column({ name: 'latency_ms', type: 'int', nullable: true })
  latencyMs!: number | null;

  /** Timestamp when the usage was recorded */
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // Relations

  /** Many-to-one relationship with User (usage belongs to a user) */
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user!: User | null;

  /** Many-to-one relationship with Tenant (usage belongs to a tenant) */
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  /** Many-to-one relationship with Conversation (usage belongs to a conversation) */
  @ManyToOne(() => Conversation, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Conversation | null;
}

/**
 * Job Status Enum
 *
 * Defines the possible states of an asynchronous job in the queue system.
 * Used for tracking job lifecycle from submission to completion.
 */
export enum JobStatus {
  /** Job is waiting in the queue to be processed */
  QUEUED = 'queued',

  /** Job is currently being processed by a worker */
  PROCESSING = 'processing',

  /** Job completed successfully */
  COMPLETED = 'completed',

  /** Job failed during processing */
  FAILED = 'failed',
}

/**
 * Job Result Interface
 *
 * Defines the structure of results returned by completed asynchronous jobs.
 * Includes generated content and token usage statistics for billing.
 */
export interface JobResult {
  /** The generated content from the AI model */
  content: string;

  /** Token usage breakdown for the job */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };

  /** Additional metadata fields that may be included in job results */
  [key: string]: any; // Index signature for TypeORM compatibility
}

/**
 * Async Job Entity
 *
 * Represents asynchronous AI processing jobs managed through BullMQ queues.
 * Tracks job status, results, and metadata for background processing of
 * complex AI tasks. Supports job types like document analysis, batch processing,
 * and long-running AI operations.
 */
@Entity('async_jobs')
export class AsyncJob {
  /** Unique job identifier (BullMQ job ID, string-based) */
  @Column({ primary: true, length: 255 })
  id!: string;

  /** ID of the user who submitted the job (nullable for system jobs) */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  /** ID of the tenant the job belongs to (required for multi-tenancy) */
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** Type of job being processed (e.g., 'document-analysis', 'batch-chat') */
  @Column({ name: 'job_type', length: 100 })
  jobType!: string;

  /** Current status of the job in its lifecycle */
  @Column({
    type: 'enum',
    enum: JobStatus,
    default: JobStatus.QUEUED,
  })
  status!: JobStatus;

  /** Result data from completed job (null for incomplete jobs) */
  @Column({ type: 'jsonb', nullable: true })
  result!: JobResult | null;

  /** Error message if the job failed (null for successful jobs) */
  @Column({ type: 'text', nullable: true })
  error!: string | null;

  /** Timestamp when job processing started (null if not started) */
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  /** Timestamp when job processing completed (null if not completed) */
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  /** Timestamp when the job was created/submitted */
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // Relations

  /** Many-to-one relationship with User (job belongs to a user) */
  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'user_id' })
  user!: User | null;

  /** Many-to-one relationship with Tenant (job belongs to a tenant) */
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;
}
