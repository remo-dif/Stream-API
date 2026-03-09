import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from '../database/entities/user.entity';
import { Tenant } from '../database/entities/tenant.entity';

/**
 * Admin Service
 *
 * Provides business logic for administrative operations in the AI SaaS application.
 * Handles user management within tenants, role assignments, account activation/deactivation,
 * and tenant-wide analytics. Implements role-based access control with different
 * permissions for ADMIN and SUPERADMIN users.
 */
@Injectable()
export class AdminService {
  /**
   * Constructor - Injects required repositories
   * @param userRepository - TypeORM repository for User entity operations
   * @param tenantRepository - TypeORM repository for Tenant entity operations
   */
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
  ) {}

  /**
   * List all users in a tenant
   *
   * Retrieves all users belonging to a specific tenant with their tenant relationship loaded.
   * Used by ADMIN users to manage users within their organization.
   *
   * @param tenantId - Unique identifier of the tenant
   * @returns Promise<{users: User[]}> - Object containing array of users with tenant data
   */
  async listUsers(tenantId: string) {
    const users = await this.userRepository.find({
      where: { tenantId },
      relations: ['tenant'],
      order: { createdAt: 'DESC' },
    });
    return { users };
  }

  /**
   * Update user role within tenant
   *
   * Changes the role of a user within their tenant. Only allows promotion/demotion
   * between USER and ADMIN roles. SUPERADMIN role can only be assigned by SUPERADMIN users.
   * Validates that the user exists and belongs to the specified tenant.
   *
   * @param userId - Unique identifier of the user to update
   * @param tenantId - Tenant identifier for authorization (user must belong to this tenant)
   * @param role - New role to assign (USER or ADMIN only)
   * @returns Promise<User> - Updated user object
   * @throws BadRequestException - If invalid role is provided
   * @throws NotFoundException - If user is not found in the tenant
   */
  async updateRole(userId: string, tenantId: string, role: UserRole) {
    const validRoles = [UserRole.USER, UserRole.ADMIN];
    if (!validRoles.includes(role)) {
      throw new BadRequestException(`Role must be one of: ${validRoles.join(', ')}`);
    }

    const result = await this.userRepository.update({ id: userId, tenantId }, { role });

    if (result.affected === 0) {
      throw new NotFoundException('User not found');
    }

    return this.userRepository.findOne({ where: { id: userId } });
  }

  /**
   * Update user active status
   *
   * Activates or deactivates a user account within the tenant. Deactivated users
   * cannot authenticate or access the system. Validates that the user exists
   * and belongs to the specified tenant.
   *
   * @param userId - Unique identifier of the user to update
   * @param tenantId - Tenant identifier for authorization (user must belong to this tenant)
   * @param isActive - New active status (true for active, false for deactivated)
   * @returns Promise<User> - Updated user object
   * @throws NotFoundException - If user is not found in the tenant
   */
  async updateStatus(userId: string, tenantId: string, isActive: boolean) {
    const result = await this.userRepository.update({ id: userId, tenantId }, { isActive });

    if (result.affected === 0) {
      throw new NotFoundException('User not found');
    }

    return this.userRepository.findOne({ where: { id: userId } });
  }

  /**
   * List all tenants with user counts (SUPERADMIN only)
   *
   * Retrieves all tenants in the system along with the count of users in each tenant.
   * This operation is restricted to SUPERADMIN users and provides system-wide visibility.
   * Uses a custom query to efficiently count users per tenant.
   *
   * @returns Promise<{tenants: Tenant[]}> - Array of tenants with user count metadata
   */
  async listTenants() {
    const tenants = await this.tenantRepository
      .createQueryBuilder('t')
      .leftJoin('t.users', 'u')
      .select(['t.*', 'COUNT(u.id) as user_count'])
      .groupBy('t.id')
      .orderBy('t.created_at', 'DESC')
      .getRawMany();

    return { tenants };
  }
}
