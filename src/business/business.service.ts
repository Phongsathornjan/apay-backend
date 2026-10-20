import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Business } from './entities/business.entity';

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
}
