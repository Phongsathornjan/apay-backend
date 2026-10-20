import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BusinessSubscription } from '../subscriptions/entities/business-subscription.entity';
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';
import { Package } from './entities/package.entity';

@Injectable()
export class PackagesService {
  constructor(
    @InjectRepository(Package)
    private readonly packagesRepository: Repository<Package>,
    @InjectRepository(BusinessSubscription)
    private readonly subscriptionsRepository: Repository<BusinessSubscription>,
  ) {}

  async create(dto: CreatePackageDto): Promise<Package> {
    const existing = await this.packagesRepository.findOne({
      where: { code: dto.code },
      withDeleted: true,
    });

    if (existing) {
      throw new ConflictException('Package code already exists');
    }

    const pkg = this.packagesRepository.create({
      description: null,
      billing_cycle_months: 1,
      is_active: true,
      ...dto,
    });

    return this.packagesRepository.save(pkg);
  }

  findAll(onlyActive = false): Promise<Package[]> {
    return this.packagesRepository.find({
      where: onlyActive ? { is_active: true } : {},
      order: { created_at: 'DESC' },
    });
  }

  async findByIdOrFail(id: string): Promise<Package> {
    const pkg = await this.packagesRepository.findOne({ where: { id } });

    if (!pkg) {
      throw new NotFoundException('Package not found');
    }

    return pkg;
  }

  async findActiveByIdOrFail(id: string): Promise<Package> {
    const pkg = await this.findByIdOrFail(id);

    if (!pkg.is_active) {
      throw new BadRequestException('Package is not active');
    }

    return pkg;
  }

  async update(id: string, dto: UpdatePackageDto): Promise<Package> {
    const pkg = await this.findByIdOrFail(id);

    if (dto.code && dto.code !== pkg.code) {
      const duplicated = await this.packagesRepository.findOne({
        where: { code: dto.code },
        withDeleted: true,
      });

      if (duplicated) {
        throw new ConflictException('Package code already exists');
      }
    }

    Object.assign(pkg, dto);

    return this.packagesRepository.save(pkg);
  }

  async softDelete(id: string): Promise<{ id: string; deleted: true }> {
    const pkg = await this.findByIdOrFail(id);

    const activeSubscriptions = await this.subscriptionsRepository.count({
      where: {
        package_id: pkg.id,
        status: In(['ACTIVE', 'PAST_DUE']),
      },
    });

    if (activeSubscriptions > 0) {
      throw new ConflictException(
        'Cannot delete package with active or past-due subscriptions',
      );
    }

    pkg.is_active = false;
    await this.packagesRepository.save(pkg);
    await this.packagesRepository.softRemove(pkg);

    return { id: pkg.id, deleted: true };
  }
}
