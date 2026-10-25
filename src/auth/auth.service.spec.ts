import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { ApiKey } from '../api-keys/entities/api-key.entity';
import { Business } from '../business/entities/business.entity';
import { BusinessService } from '../business/business.service';
import { sha256 } from '../common/utils/crypto.util';
import { RoleEnum } from '../enums';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { Role } from '../users/entities/role.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

const RAW_API_KEY =
  'apay_live_1a2b3c4d_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c';

describe('AuthService', () => {
  let service: AuthService;

  const jwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };

  const configService = {
    get: jest.fn(),
    getOrThrow: jest.fn(),
  };

  const usersService = {
    findByUsername: jest.fn(),
    findById: jest.fn(),
    updateRefreshTokenHash: jest.fn(),
  };

  const businessService = {
    findByUserId: jest.fn(),
    updateRefreshTokenHash: jest.fn(),
  };

  const subscriptionsService = {
    assignOrChangePackage: jest.fn(),
  };

  const apiKeysRepository = {
    findOne: jest.fn(),
    update: jest.fn(),
  };

  const usersRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const rolesRepository = {
    findOne: jest.fn(),
  };

  const businessesRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const manager = {
    getRepository: jest.fn(),
  };

  const dataSource = {
    transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    configService.get.mockReturnValue(undefined);
    configService.getOrThrow.mockImplementation((key: string) =>
      key === 'JWT_SECRET' ? 'access-secret' : 'refresh-secret',
    );

    jwtService.signAsync
      .mockResolvedValueOnce('access-token')
      .mockResolvedValueOnce('refresh-token');

    apiKeysRepository.update.mockResolvedValue({ affected: 1 });

    manager.getRepository.mockImplementation((entity: unknown) => {
      if (entity === User) return usersRepository;
      if (entity === Role) return rolesRepository;
      if (entity === Business) return businessesRepository;
      if (entity === ApiKey) return apiKeysRepository;

      throw new Error('Unknown repository');
    });

    dataSource.transaction.mockImplementation(
      async (callback: (m: unknown) => unknown) => callback(manager),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: UsersService, useValue: usersService },
        { provide: BusinessService, useValue: businessService },
        { provide: SubscriptionsService, useValue: subscriptionsService },
        { provide: getRepositoryToken(ApiKey), useValue: apiKeysRepository },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('login', () => {
    it('logs in an admin user and returns token bundle with user info', async () => {
      const passwordHash = await bcrypt.hash('AdminPass123!', 4);
      usersService.findByUsername.mockResolvedValue({
        id: 'admin-1',
        username: 'admin',
        password_hash: passwordHash,
        is_active: true,
        role: { name: RoleEnum.ADMIN },
      });

      const result = await service.login({
        username: 'admin',
        password: 'AdminPass123!',
      });

      expect(result).toMatchObject({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_type: 'Bearer',
        user: {
          user_id: 'admin-1',
          username: 'admin',
          role: RoleEnum.ADMIN,
          business_id: null,
        },
      });
      expect(usersService.updateRefreshTokenHash).toHaveBeenCalledWith(
        'admin-1',
        sha256('refresh-token'),
      );
      expect(businessService.findByUserId).not.toHaveBeenCalled();
    });

    it('logs in a business user and resolves business_id', async () => {
      const passwordHash = await bcrypt.hash('MerchantPass123!', 4);
      usersService.findByUsername.mockResolvedValue({
        id: 'user-1',
        username: 'merchant',
        password_hash: passwordHash,
        is_active: true,
        role: { name: RoleEnum.BUSINESS },
      });
      businessService.findByUserId.mockResolvedValue({
        id: 'business-1',
        is_active: true,
        line_user_id: 'U-owner',
      });

      const result = await service.login({
        username: 'merchant',
        password: 'MerchantPass123!',
      });

      expect(result.user).toEqual({
        user_id: 'user-1',
        username: 'merchant',
        role: RoleEnum.BUSINESS,
        business_id: 'business-1',
        line_user_id: 'U-owner',
      });
      expect(businessService.updateRefreshTokenHash).toHaveBeenCalledWith(
        'business-1',
        sha256('refresh-token'),
      );
    });

    it('rejects unknown or inactive users', async () => {
      usersService.findByUsername.mockResolvedValue(null);

      await expect(
        service.login({ username: 'unknown', password: 'pw' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects wrong passwords', async () => {
      const passwordHash = await bcrypt.hash('CorrectPass123!', 4);
      usersService.findByUsername.mockResolvedValue({
        id: 'user-1',
        username: 'merchant',
        password_hash: passwordHash,
        is_active: true,
        role: { name: RoleEnum.BUSINESS },
      });

      await expect(
        service.login({ username: 'merchant', password: 'WrongPassword!' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when the business account is inactive', async () => {
      const passwordHash = await bcrypt.hash('MerchantPass123!', 4);
      usersService.findByUsername.mockResolvedValue({
        id: 'user-1',
        username: 'merchant',
        password_hash: passwordHash,
        is_active: true,
        role: { name: RoleEnum.BUSINESS },
      });
      businessService.findByUserId.mockResolvedValue({
        id: 'business-1',
        is_active: false,
      });

      await expect(
        service.login({ username: 'merchant', password: 'MerchantPass123!' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('registerBusiness', () => {
    beforeEach(() => {
      usersRepository.findOne.mockResolvedValue(null);
      businessesRepository.findOne.mockResolvedValue(null);
      rolesRepository.findOne.mockResolvedValue({ id: 'role-business' });
      usersRepository.create.mockImplementation((data) => data);
      usersRepository.save.mockResolvedValue({
        id: 'user-1',
        username: 'merchant',
      });
      businessesRepository.create.mockImplementation((data) => data);
      businessesRepository.save.mockImplementation(async (data) => ({
        id: 'business-1',
        ...data,
      }));
    });

    it('creates the user, business and optional package inside one transaction', async () => {
      const result = await service.registerBusiness({
        username: 'merchant',
        password: 'StrongPass123!',
        business_name: 'Coffee Shop',
        email: 'owner@coffee-shop.com',
        promptpay_id: '0812345678',
      });

      expect(businessesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          business_name: 'Coffee Shop',
          email: 'owner@coffee-shop.com',
          api_key_prefix: null,
          api_key_hash: null,
          line_user_id: null,
        }),
      );
      expect(result).toMatchObject({
        user_id: 'user-1',
        username: 'merchant',
        role: 'business',
        business_id: 'business-1',
        email: 'owner@coffee-shop.com',
        line_user_id: null,
      });
      expect(result).not.toHaveProperty('api_key');
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(
        subscriptionsService.assignOrChangePackage,
      ).not.toHaveBeenCalled();
    });

    it('assigns the requested package within the same transaction', async () => {
      await service.registerBusiness({
        username: 'merchant',
        password: 'StrongPass123!',
        business_name: 'Coffee Shop',
        email: 'owner@coffee-shop.com',
        promptpay_id: '0812345678',
        line_user_id: 'U-owner',
        package_id: 'package-1',
      });

      expect(businessesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ line_user_id: 'U-owner' }),
      );
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(
        subscriptionsService.assignOrChangePackage,
      ).toHaveBeenCalledWith('business-1', 'package-1', manager);
    });

    it('propagates package assignment errors so the transaction rolls back', async () => {
      const error = new BadRequestException('Package is not available');
      subscriptionsService.assignOrChangePackage.mockRejectedValueOnce(error);

      await expect(
        service.registerBusiness({
          username: 'merchant',
          password: 'StrongPass123!',
          business_name: 'Coffee Shop',
          email: 'owner@coffee-shop.com',
          promptpay_id: '0812345678',
          package_id: 'missing-package',
        }),
      ).rejects.toBe(error);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(usersRepository.save).toHaveBeenCalledTimes(1);
      expect(businessesRepository.save).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException when username already exists', async () => {
      usersRepository.findOne.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.registerBusiness({
          username: 'merchant',
          password: 'StrongPass123!',
          business_name: 'Coffee Shop',
          email: 'owner@coffee-shop.com',
          promptpay_id: '0812345678',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException when email already exists', async () => {
      businessesRepository.findOne.mockResolvedValue({ id: 'existing-business' });

      await expect(
        service.registerBusiness({
          username: 'merchant',
          password: 'StrongPass123!',
          business_name: 'Coffee Shop',
          email: 'owner@coffee-shop.com',
          promptpay_id: '0812345678',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(usersRepository.save).not.toHaveBeenCalled();
    });

    it('throws InternalServerErrorException when business role is missing', async () => {
      rolesRepository.findOne.mockResolvedValue(null);

      await expect(
        service.registerBusiness({
          username: 'merchant',
          password: 'StrongPass123!',
          business_name: 'Coffee Shop',
          email: 'owner@coffee-shop.com',
          promptpay_id: '0812345678',
        }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('exchangeApiKey', () => {
    const apiKeyRecord = {
      id: 'key-1',
      key_hash: sha256(RAW_API_KEY),
      is_active: true,
      business: {
        id: 'business-1',
        user_id: 'user-1',
        is_active: true,
        user: {
          id: 'user-1',
          username: 'merchant',
          is_active: true,
        },
      },
    };

    it('exchanges a valid API key and embeds api_key_id in the tokens', async () => {
      apiKeysRepository.findOne.mockResolvedValue(apiKeyRecord);

      const result = await service.exchangeApiKey({ api_key: RAW_API_KEY });

      expect(apiKeysRepository.findOne).toHaveBeenCalledWith({
        where: { key_prefix: 'apay_live_1a2b3c4d', is_active: true },
        relations: { business: { user: true } },
      });
      expect(jwtService.signAsync).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          sub: 'user-1',
          business_id: 'business-1',
          api_key_id: 'key-1',
          type: 'access',
        }),
        expect.any(Object),
      );
      expect(jwtService.signAsync).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ api_key_id: 'key-1', type: 'refresh' }),
        expect.any(Object),
      );
      expect(apiKeysRepository.update).toHaveBeenCalledWith(
        { id: 'key-1' },
        {
          refresh_token_hash: sha256('refresh-token'),
          last_used_at: expect.any(Date),
        },
      );
      expect(result).toMatchObject({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        token_type: 'Bearer',
      });
    });

    it('rejects a wrong API key hash', async () => {
      apiKeysRepository.findOne.mockResolvedValue({
        ...apiKeyRecord,
        key_hash: sha256('another-key'),
      });

      await expect(
        service.exchangeApiKey({ api_key: RAW_API_KEY }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects unknown or inactive API keys', async () => {
      apiKeysRepository.findOne.mockResolvedValue(null);

      await expect(
        service.exchangeApiKey({ api_key: RAW_API_KEY }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when no API key is provided', async () => {
      await expect(service.exchangeApiKey({})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('refresh', () => {
    const refreshToken = 'refresh-token-value';

    const user = {
      id: 'user-1',
      username: 'merchant',
      is_active: true,
      role: { name: 'business' },
      refresh_token_hash: null,
    };

    const business = {
      id: 'business-1',
      is_active: true,
      refresh_token_hash: null,
    };

    it('rotates the refresh token hash stored on the API key', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        type: 'refresh',
        api_key_id: 'key-1',
      });
      usersService.findById.mockResolvedValue(user);
      businessService.findByUserId.mockResolvedValue(business);
      apiKeysRepository.findOne.mockResolvedValue({
        id: 'key-1',
        is_active: true,
        deleted_at: null,
        refresh_token_hash: sha256(refreshToken),
      });

      const result = await service.refresh(refreshToken);

      expect(apiKeysRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'key-1' },
        withDeleted: true,
      });
      expect(jwtService.signAsync).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ api_key_id: 'key-1' }),
        expect.any(Object),
      );
      expect(apiKeysRepository.update).toHaveBeenCalledWith(
        { id: 'key-1' },
        {
          refresh_token_hash: sha256('refresh-token'),
          last_used_at: expect.any(Date),
        },
      );
      expect(result.refresh_token).toBe('refresh-token');
    });

    it('rejects when the API key has been deactivated or revoked', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        type: 'refresh',
        api_key_id: 'key-1',
      });
      usersService.findById.mockResolvedValue(user);
      businessService.findByUserId.mockResolvedValue(business);
      apiKeysRepository.findOne.mockResolvedValue({
        id: 'key-1',
        is_active: false,
        deleted_at: null,
        refresh_token_hash: sha256(refreshToken),
      });

      await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects when the stored API key hash does not match', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        type: 'refresh',
        api_key_id: 'key-1',
      });
      usersService.findById.mockResolvedValue(user);
      businessService.findByUserId.mockResolvedValue(business);
      apiKeysRepository.findOne.mockResolvedValue({
        id: 'key-1',
        is_active: true,
        deleted_at: null,
        refresh_token_hash: sha256('different-token'),
      });

      await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('falls back to the legacy user/business refresh hash when no api_key_id is present', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        type: 'refresh',
      });
      usersService.findById.mockResolvedValue(user);
      businessService.findByUserId.mockResolvedValue({
        ...business,
        refresh_token_hash: sha256(refreshToken),
      });

      const result = await service.refresh(refreshToken);

      expect(apiKeysRepository.findOne).not.toHaveBeenCalled();
      expect(apiKeysRepository.update).not.toHaveBeenCalled();
      expect(result.refresh_token).toBe('refresh-token');
    });
  });
});
