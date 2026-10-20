import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApiKey } from '../api-keys/entities/api-key.entity';
import { Business } from '../business/entities/business.entity';
import { BusinessService } from '../business/business.service';
import { sha256 } from '../common/utils/crypto.util';
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

  describe('registerBusiness', () => {
    beforeEach(() => {
      usersRepository.findOne.mockResolvedValue(null);
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

    it('creates only the user and business without an API key', async () => {
      const result = await service.registerBusiness({
        username: 'merchant',
        password: 'StrongPass123!',
        business_name: 'Coffee Shop',
        promptpay_id: '0812345678',
      });

      expect(businessesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          api_key_prefix: null,
          api_key_hash: null,
        }),
      );
      expect(result).toMatchObject({
        user_id: 'user-1',
        username: 'merchant',
        role: 'business',
        business_id: 'business-1',
      });
      expect(result).not.toHaveProperty('api_key');
      expect(
        subscriptionsService.assignOrChangePackage,
      ).not.toHaveBeenCalled();
    });

    it('assigns the requested package after creating the business', async () => {
      await service.registerBusiness({
        username: 'merchant',
        password: 'StrongPass123!',
        business_name: 'Coffee Shop',
        promptpay_id: '0812345678',
        package_id: 'package-1',
      });

      expect(
        subscriptionsService.assignOrChangePackage,
      ).toHaveBeenCalledWith('business-1', 'package-1');
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
