import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { AuthUser } from '../auth/types/auth-user.type';
import { RoleEnum } from '../enums';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { Role } from '../users/entities/role.entity';
import { User } from '../users/entities/user.entity';
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

  const usersRepository = {
    findOne: jest.fn(),
    create: jest.fn((data: Partial<User>) => data),
    save: jest.fn(),
  };

  const rolesRepository = {
    findOne: jest.fn(),
  };

  const subscriptionsService = {
    assignOrChangePackage: jest.fn(),
  };

  const manager = {
    getRepository: jest.fn(),
  };

  const dataSource = {
    transaction: jest.fn(),
  };

  beforeEach(async () => {
    businessRepository = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 'biz-1', ...data })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    jest.clearAllMocks();

    usersRepository.findOne.mockResolvedValue(null);
    usersRepository.create.mockImplementation((data: Partial<User>) => data);
    usersRepository.save.mockResolvedValue({
      id: 'user-1',
      username: 'merchant',
    });
    businessRepository.findOne.mockResolvedValue(null);
    businessRepository.create.mockImplementation((data) => data);
    businessRepository.save.mockImplementation(async (data) => ({
      id: 'biz-1',
      ...data,
    }));
    rolesRepository.findOne.mockResolvedValue({ id: 'role-business' });

    manager.getRepository.mockImplementation((entity: unknown) => {
      if (entity === User) return usersRepository;
      if (entity === Role) return rolesRepository;
      if (entity === Business) return businessRepository;

      throw new Error('Unknown repository');
    });
    dataSource.transaction.mockImplementation(
      async (callback: (m: unknown) => unknown) => callback(manager),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessService,
        { provide: getRepositoryToken(Business), useValue: businessRepository },
        { provide: SubscriptionsService, useValue: subscriptionsService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<BusinessService>(BusinessService);
  });

  it('finds business by id, userId, line_destination and line_user_id', async () => {
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

    await service.findByLineUserId('U123456');
    expect(businessRepository.findOne).toHaveBeenLastCalledWith({
      where: { line_user_id: 'U123456' },
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

  describe('registerBusiness', () => {
    const payload = {
      username: 'merchant',
      password: 'StrongPass123!',
      business_name: 'Coffee Shop',
      email: 'owner@coffee-shop.com',
      promptpay_id: '0812345678',
    };

    it('creates the user and business inside one transaction', async () => {
      const result = await service.registerBusiness(payload);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(usersRepository.create).toHaveBeenCalledWith({
        username: 'merchant',
        password_hash: expect.any(String),
        role_id: 'role-business',
        is_active: true,
      });
      expect(businessRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-1',
          business_name: 'Coffee Shop',
          email: 'owner@coffee-shop.com',
          promptpay_id: '0812345678',
          api_key_prefix: null,
          api_key_hash: null,
          line_destination: null,
          line_user_id: null,
          is_active: true,
        }),
      );
      expect(result).toMatchObject({
        user_id: 'user-1',
        username: 'merchant',
        role: 'business',
        business_id: 'biz-1',
        business_name: 'Coffee Shop',
        email: 'owner@coffee-shop.com',
        promptpay_id: '0812345678',
        line_user_id: null,
      });
      expect(
        subscriptionsService.assignOrChangePackage,
      ).not.toHaveBeenCalled();
    });

    it('hashes the password before saving it', async () => {
      await service.registerBusiness(payload);

      const saved = usersRepository.create.mock.calls[0][0];

      expect(saved.password_hash).not.toBe(payload.password);
      await expect(
        bcrypt.compare(payload.password, saved.password_hash),
      ).resolves.toBe(true);
    });

    it('assigns the requested package within the same transaction', async () => {
      await service.registerBusiness({
        ...payload,
        line_destination: 'U-destination',
        line_user_id: 'U-owner',
        package_id: 'package-1',
      });

      expect(businessRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          line_destination: 'U-destination',
          line_user_id: 'U-owner',
        }),
      );
      expect(
        subscriptionsService.assignOrChangePackage,
      ).toHaveBeenCalledWith('biz-1', 'package-1', manager);
    });

    it('propagates package assignment errors so the transaction rolls back', async () => {
      const error = new BadRequestException('Package is not available');
      subscriptionsService.assignOrChangePackage.mockRejectedValueOnce(error);

      await expect(
        service.registerBusiness({ ...payload, package_id: 'missing-package' }),
      ).rejects.toBe(error);
      expect(usersRepository.save).toHaveBeenCalledTimes(1);
      expect(businessRepository.save).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException when the username already exists', async () => {
      usersRepository.findOne.mockResolvedValue({ id: 'existing-user' });

      await expect(service.registerBusiness(payload)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(usersRepository.save).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the email already exists', async () => {
      businessRepository.findOne.mockResolvedValue({ id: 'existing-business' });

      await expect(service.registerBusiness(payload)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(usersRepository.save).not.toHaveBeenCalled();
    });

    it('throws InternalServerErrorException when the business role is missing', async () => {
      rolesRepository.findOne.mockResolvedValue(null);

      await expect(service.registerBusiness(payload)).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
      expect(usersRepository.save).not.toHaveBeenCalled();
    });
  });
});
