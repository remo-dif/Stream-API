import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from '../database/entities/user.entity';
import { Tenant } from '../database/entities/tenant.entity';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
  ) {}

  async listUsers(tenantId: string) {
    const users = await this.userRepository.find({
      where: { tenantId },
      relations: ['tenant'],
      order: { createdAt: 'DESC' },
    });
    return { users };
  }

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

  async updateStatus(userId: string, tenantId: string, isActive: boolean) {
    const result = await this.userRepository.update({ id: userId, tenantId }, { isActive });

    if (result.affected === 0) {
      throw new NotFoundException('User not found');
    }

    return this.userRepository.findOne({ where: { id: userId } });
  }

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
