import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Conversation } from './conversation.entity';
import { Exclude } from 'class-transformer';

/**
 * User Role Enum
 *
 * Defines the hierarchical roles for users in the system. Roles determine
 * access levels and permissions for different operations. Higher roles
 * inherit permissions from lower roles.
 */
export enum UserRole {
  /** Basic user with access to chat and personal data */
  USER = 'user',

  /** Administrative user with tenant management capabilities */
  ADMIN = 'admin',

  /** Super administrator with cross-tenant management capabilities */
  SUPERADMIN = 'superadmin',
}

/**
 * User Entity
 *
 * Represents a user account in the AI SaaS platform. Contains authentication
 * information, role-based permissions, and relationships to tenants and conversations.
 * Implements multi-tenancy by associating users with specific tenants while
 * supporting cross-tenant access for super administrators.
 */
@Entity('users')
export class User {
  /** Unique identifier for the user (UUID) */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** ID of the tenant this user belongs to (enforces multi-tenancy) */
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** User's email address (unique across the system) */
  @Column({ unique: true, length: 320 })
  email!: string;

  /** Hashed password for authentication (excluded from serialization) */
  @Column({ name: 'password_hash', length: 255 })
  @Exclude()
  passwordHash!: string;

  /** User's role determining access permissions and capabilities */
  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER,
  })
  role!: UserRole;

  /** Flag indicating if the user account is active (can authenticate) */
  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  /** Timestamp of the user's last successful login (for security monitoring) */
  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  /** Flexible JSON storage for user-specific preferences and metadata */
  @Column({ type: 'jsonb', default: {} })
  metadata!: Record<string, any>;

  /** Timestamp when the user account was created */
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** Timestamp when the user account was last updated */
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  // Relations

  /** Many-to-one relationship with Tenant (user belongs to a tenant) */
  @ManyToOne(() => Tenant, (tenant) => tenant.users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  /** One-to-many relationship with Conversation (user has many conversations) */
  @OneToMany(() => Conversation, (conversation) => conversation.user)
  conversations!: Conversation[];
}
