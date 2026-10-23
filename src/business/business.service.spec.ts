import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthUser } from '../auth/types/auth-user.type';
import { RoleEnum } from '../enums';
import { BusinessService } from './business.service';
import { Business } from './entities/business.entity';

describe('BusinessService', () => {
  let service: BusinessService;
  let businessRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };

  beforeEach(async () => {
    businessRepository = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 'biz-1', ...data })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessService,
        { provide: getRepositoryToken(Business), useValue: businessRepository },
      ],
    }).compile();

    service = module.get<BusinessService>(BusinessService);
  });

  it('finds business by id, userId, and line_destination', async () => {
    businessRepository.findOne.mockResolvedValue({ id: 'biz-1' });

    await service.findById('biz-1');
    expect(businessRepository.findOne).toHaveBeenLastCalledWith({
      where: { id: 'biz-1' },
    });

    await service.findByUserId('user-1');
    expect(businessRepository.findOne).toHaveBeenLastCalledWith({
      where: { user_id: 'user-1' },
    });

    await service.findByLineDestination('U123456');
    expect(businessRepository.findOne).toHaveBeenLastCalledWith({
      where: { line_destination: 'U123456' },
    });
  });

  describe('assertBusinessAccess', () => {
    const businessUser: AuthUser = {
      userId: 'user-1',
      username: 'merchant',
      role: RoleEnum.BUSINESS,
      businessId: 'biz-1',
    };

    const adminUser: AuthUser = {
      userId: 'admin-1',
      username: 'admin',
      role: RoleEnum.ADMIN,
      businessId: null,
    };

    it('allows business user to access their own business', () => {
      expect(() =>
        service.assertBusinessAccess(businessUser, 'biz-1'),
      ).not.toThrow();
    });

    it('throws NotFoundException when business user accesses another business', () => {
      expect(() =>
        service.assertBusinessAccess(businessUser, 'biz-other'),
      ).toThrow(NotFoundException);
    });

    it('throws NotFoundException when business user has no businessId', () => {
      expect(() =>
        service.assertBusinessAccess(
          { ...businessUser, businessId: null },
          'biz-1',
        ),
      ).toThrow(NotFoundException);
    });

    it('allows admin user to access any business', () => {
      expect(() =>
        service.assertBusinessAccess(adminUser, 'biz-any'),
      ).not.toThrow();
    });
  });

  it('creates a business record', async () => {
    const result = await service.create({
      user_id: 'user-1',
      business_name: 'Cafe',
      promptpay_id: '0812345678',
    });

    expect(businessRepository.create).toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'biz-1', business_name: 'Cafe' });
  });

  it('updates refresh_token_hash on business', async () => {
    await service.updateRefreshTokenHash('biz-1', 'hash-val');

    expect(businessRepository.update).toHaveBeenCalledWith(
      { id: 'biz-1' },
      { refresh_token_hash: 'hash-val' },
    );
  });

  describe('resolveBusinessId', () => {
    it('returns businessId when present on user', async () => {
      await expect(
        service.resolveBusinessId({
          userId: 'user-1',
          username: 'merchant',
          role: RoleEnum.BUSINESS,
          businessId: 'biz-1',
        }),
      ).resolves.toBe('biz-1');
    });

    it('throws BadRequestException when businessId is missing', async () => {
      await expect(
        service.resolveBusinessId({
          userId: 'user-1',
          username: 'merchant',
          role: RoleEnum.BUSINESS,
          businessId: null,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
