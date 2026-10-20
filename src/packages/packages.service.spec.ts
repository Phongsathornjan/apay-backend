import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BusinessSubscription } from '../subscriptions/entities/business-subscription.entity';
import { Package } from './entities/package.entity';
import { PackagesService } from './packages.service';

describe('PackagesService', () => {
  let service: PackagesService;

  const packagesRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    softRemove: jest.fn(),
  };

  const subscriptionsRepository = {
    count: jest.fn(),
  };

  const buildPackage = (overrides: Partial<Package> = {}): Package =>
    ({
      id: 'package-1',
      code: 'FREE',
      name: 'Free',
      description: null,
      price: 0,
      max_api_keys: 1,
      quota_limit: 100,
      rate_limit_per_hour: 60,
      billing_cycle_months: 1,
      is_active: true,
      ...overrides,
    }) as Package;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PackagesService,
        {
          provide: getRepositoryToken(Package),
          useValue: packagesRepository,
        },
        {
          provide: getRepositoryToken(BusinessSubscription),
          useValue: subscriptionsRepository,
        },
      ],
    }).compile();

    service = module.get<PackagesService>(PackagesService);
  });

  it('creates a package when the code is not duplicated', async () => {
    const dto = {
      code: 'STARTER',
      name: 'Starter',
      price: 499,
      max_api_keys: 3,
      quota_limit: 1000,
      rate_limit_per_hour: 300,
    };

    packagesRepository.findOne.mockResolvedValue(null);
    packagesRepository.create.mockImplementation((data) => data);
    packagesRepository.save.mockImplementation(async (data) => ({
      id: 'package-1',
      ...data,
    }));

    const result = await service.create(dto);

    expect(packagesRepository.findOne).toHaveBeenCalledWith({
      where: { code: 'STARTER' },
      withDeleted: true,
    });
    expect(packagesRepository.create).toHaveBeenCalledWith({
      description: null,
      billing_cycle_months: 1,
      is_active: true,
      ...dto,
    });
    expect(result).toMatchObject({ code: 'STARTER', quota_limit: 1000 });
  });

  it('throws 409 when the package code already exists', async () => {
    packagesRepository.findOne.mockResolvedValue(buildPackage());

    await expect(
      service.create({
        code: 'FREE',
        name: 'Free',
        price: 0,
        max_api_keys: 1,
        quota_limit: 100,
        rate_limit_per_hour: 60,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lists only active packages when requested', async () => {
    packagesRepository.find.mockResolvedValue([]);

    await service.findAll(true);

    expect(packagesRepository.find).toHaveBeenCalledWith({
      where: { is_active: true },
      order: { created_at: 'DESC' },
    });
  });

  it('throws 404 when a package is not found', async () => {
    packagesRepository.findOne.mockResolvedValue(null);

    await expect(service.findByIdOrFail('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws 400 when the package is inactive', async () => {
    packagesRepository.findOne.mockResolvedValue(
      buildPackage({ is_active: false }),
    );

    await expect(
      service.findActiveByIdOrFail('package-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates a package and rejects a duplicated code', async () => {
    packagesRepository.findOne
      .mockResolvedValueOnce(buildPackage({ code: 'FREE' }))
      .mockResolvedValueOnce(buildPackage({ id: 'package-2', code: 'PRO' }));

    await expect(
      service.update('package-1', { code: 'PRO' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not delete a package that still has active/past-due subscriptions', async () => {
    packagesRepository.findOne.mockResolvedValue(buildPackage());
    subscriptionsRepository.count.mockResolvedValue(1);

    await expect(service.softDelete('package-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(packagesRepository.softRemove).not.toHaveBeenCalled();
  });

  it('deactivates and soft-deletes a package without in-use subscriptions', async () => {
    const pkg = buildPackage();
    packagesRepository.findOne.mockResolvedValue(pkg);
    subscriptionsRepository.count.mockResolvedValue(0);
    packagesRepository.save.mockImplementation(async (data) => data);
    packagesRepository.softRemove.mockResolvedValue(pkg);

    const result = await service.softDelete('package-1');

    expect(packagesRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: false }),
    );
    expect(packagesRepository.softRemove).toHaveBeenCalled();
    expect(result).toEqual({ id: 'package-1', deleted: true });
  });
});
