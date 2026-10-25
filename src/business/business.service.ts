import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Business } from './entities/business.entity';
import { AuthUser } from '../auth/types/auth-user.type';
import { RoleEnum } from '../enums';

@Injectable()
export class BusinessService {
  constructor(
    @InjectRepository(Business)
    private readonly businessRepository: Repository<Business>,
  ) {}

  findById(id: string): Promise<Business | null> {
    return this.businessRepository.findOne({ where: { id } });
  }

  findByUserId(userId: string): Promise<Business | null> {
    return this.businessRepository.findOne({ where: { user_id: userId } });
  }

  findByLineDestination(destination: string): Promise<Business | null> {
    return this.businessRepository.findOne({
      where: { line_destination: destination },
    });
  }

  findByLineUserId(lineUserId: string): Promise<Business | null> {
    return this.businessRepository.findOne({
      where: { line_user_id: lineUserId },
    });
  }

  assertBusinessAccess(user: AuthUser, businessId: string): void {
    if (
      user.role === RoleEnum.BUSINESS &&
      (!user.businessId || user.businessId !== businessId)
    ) {
      throw new NotFoundException('Business not found');
    }
  }

  async create(data: Partial<Business>): Promise<Business> {
    const business = this.businessRepository.create(data);

    return this.businessRepository.save(business);
  }

  async updateRefreshTokenHash(
    businessId: string,
    hash: string | null,
  ): Promise<void> {
    await this.businessRepository.update(
      { id: businessId },
      { refresh_token_hash: hash },
    );
  }

  async resolveBusinessId(user: AuthUser): Promise<string> {
    if (!user.businessId) {
      throw new BadRequestException('Business account not found');
    }

    return user.businessId;
  }
}
