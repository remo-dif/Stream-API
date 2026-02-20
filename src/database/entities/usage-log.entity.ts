import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "./user.entity";
import { Tenant } from "./tenant.entity";
import { Conversation } from "./conversation.entity";

@Entity("usage_logs")
export class UsageLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "user_id", type: "uuid", nullable: true })
  userId!: string | null;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "conversation_id", type: "uuid", nullable: true })
  conversationId!: string | null;

  @Column({ length: 100 })
  model!: string;

  @Column({ name: "input_tokens", type: "int", default: 0 })
  inputTokens!: number;

  @Column({ name: "output_tokens", type: "int", default: 0 })
  outputTokens!: number;

  @Column({ name: "total_tokens", type: "int", default: 0 })
  totalTokens!: number;

  @Column({ name: "latency_ms", type: "int", nullable: true })
  latencyMs!: number | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  // Relations
  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "user_id" })
  user!: User | null;

  @ManyToOne(() => Tenant, { onDelete: "CASCADE" })
  @JoinColumn({ name: "tenant_id" })
  tenant!: Tenant;

  @ManyToOne(() => Conversation, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "conversation_id" })
  conversation!: Conversation | null;
}

export enum JobStatus {
  QUEUED = "queued",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
}

export interface JobResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  [key: string]: any; // ← Index signature for TypeORM
}

@Entity("async_jobs")
export class AsyncJob {
  @Column({ primary: true, length: 255 })
  id!: string;

  @Column({ name: "user_id", type: "uuid", nullable: true })
  userId!: string | null;

  @Column({ name: "tenant_id", type: "uuid" })
  tenantId!: string;

  @Column({ name: "job_type", length: 100 })
  jobType!: string;

  @Column({
    type: "enum",
    enum: JobStatus,
    default: JobStatus.QUEUED,
  })
  status!: JobStatus;

  @Column({ type: "jsonb", nullable: true })
  result!: JobResult | null;

  @Column({ type: "text", nullable: true })
  error!: string | null;

  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt!: Date | null;

  @Column({ name: "completed_at", type: "timestamptz", nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  // Relations
  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "user_id" })
  user!: User | null;

  @ManyToOne(() => Tenant, { onDelete: "CASCADE" })
  @JoinColumn({ name: "tenant_id" })
  tenant!: Tenant;
}
