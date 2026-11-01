import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthUser } from '../auth/types/auth-user.type';
import { BusinessService } from '../business/business.service';
import { Business } from '../business/entities/business.entity';
import { BusinessSubscription } from '../subscriptions/entities/business-subscription.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyUsageLog } from './entities/api-key-usage-log.entity';
import { ApiKey } from './entities/api-key.entity';

const NOW = new Date('2026-10-20T10:00:00.000Z');

function buildSubscription(
  overrides: Partial<BusinessSubscription> = {},
): BusinessSubscription {
  return {
    id: 'sub-1',
    business_id: 'business-1',
    package_id: 'package-1',
    status: 'ACTIVE',
    quota_limit: 100,
    quota_used: 10,
    quota_remaining: 90,
    rate_limit_per_hour: 60,
    max_api_keys: 3,
    current_period_start: new Date('2026-10-01T00:00:00.000Z'),
    // ใช้วันที่ในอนาคตไกล ๆ เพื่อไม่ให้เทสต์พังตามเวลาจริง (เดิมเป็น 2026-11-01)
    current_period_end: new Date('2030-01-01T00:00:00.000Z'),
    ...overrides,
  } as BusinessSubscription;
}

function buildApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'key-1',
    business_id: 'business-1',
    name: 'POS',
    key_prefix: 'apay_live_1234abcd',
    key_hash: 'hashed',
    refresh_token_hash: 'refresh-hash',
    is_active: true,
    last_used_at: NOW,
    deleted_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  } as ApiKey;
}

describe('ApiKeysService', () => {
  let service: ApiKeysService;

  const apiKeysRepository = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    softRemove: jest.fn(),
  };

  const usageLogsRepository = {
    count: jest.fn(),
    find: jest.fn(),
  };

  const businessesRepository = {
    findOne: jest.fn(),
  };

  const subscriptionsService = {
    getCurrentSubscription: jest.fn(),
    assignOrChangePackage: jest.fn(),
    getBusinessUsage: jest.fn(),
  };

  const businessService = {
    resolveBusinessId: jest.fn(),
    assertBusinessAccess: jest.fn(),
  };

  const businessUser: AuthUser = {
    userId: 'user-1',
    username: 'merchant',
    role: 'business',
    businessId: 'business-1',
  };

  const adminUser: AuthUser = {
    userId: 'admin-1',
    username: 'admin',
    role: 'admin',
    businessId: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    businessService.resolveBusinessId.mockImplementation(
      async (user: AuthUser) => {
        if (!user.businessId) {
          throw new BadRequestException('Business account not found');
        }

        return user.businessId;
      },
    );

    businessService.assertBusinessAccess.mockImplementation(
      (user: AuthUser, businessId: string) => {
        if (user.role === 'business' && user.businessId !== businessId) {
          throw new NotFoundException('Business not found');
        }
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: getRepositoryToken(ApiKey), useValue: apiKeysRepository },
        {
          provide: getRepositoryToken(ApiKeyUsageLog),
          useValue: usageLogsRepository,
        },
        {
          provide: getRepositoryToken(Business),
          useValue: businessesRepository,
        },
        { provide: SubscriptionsService, useValue: subscriptionsService },
        { provide: BusinessService, useValue: businessService },
      ],
    }).compile();

    service = module.get<ApiKeysService>(ApiKeysService);
  });

  describe('createApiKey', () => {
    it('creates a new key for a business with an active subscription', async () => {
      businessesRepository.findOne.mockResolvedValue({
        id: 'business-1',
        is_active: true,
      });
      subscriptionsService.getCurrentSubscription.mockResolvedValue(
        buildSubscription(),
      );
      apiKeysRepository.count.mockResolvedValue(1);
      apiKeysRepository.create.mockImplementation((data) => data);
      apiKeysRepository.save.mockImplementation(async (data) => ({
        id: 'key-new',
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
        last_used_at: null,
        ...data,
      }));

      const result = await service.createApiKey(businessUser, { name: 'POS' });

      expect(result.api_key).toMatch(
        /^apay_live_[0-9a-f]{8}_[0-9a-f]{32}$/,
      );
      expect(result).toMatchObject({
        id: 'key-new',
        business_id: 'business-1',
        name: 'POS',
        is_active: true,
      });
      expect(result).not.toHaveProperty('key_hash');
      expect(result).not.toHaveProperty('refresh_token_hash');
    });

    it('rejects when the subscription is PAST_DUE', async () => {
      businessesRepository.findOne.mockResolvedValue({
        id: 'business-1',
        is_active: true,
      });
      subscriptionsService.getCurrentSubscription.mockResolvedValue(
        buildSubscription({ status: 'PAST_DUE', quota_remaining: 0 }),
      );

      await expect(
        service.createApiKey(businessUser, { name: 'POS' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when there is no subscription at all', async () => {
      businessesRepository.findOne.mockResolvedValue({
        id: 'business-1',
        is_active: true,
      });
      subscriptionsService.getCurrentSubscription.mockResolvedValue(null);

      await expect(
        service.createApiKey(businessUser, { name: 'POS' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when max_api_keys is reached', async () => {
      businessesRepository.findOne.mockResolvedValue({
        id: 'business-1',
        is_active: true,
      });
      subscriptionsService.getCurrentSubscription.mockResolvedValue(
        buildSubscription({ max_api_keys: 2 }),
      );
      apiKeysRepository.count.mockResolvedValue(2);

      await expect(
        service.createApiKey(businessUser, { name: 'POS' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('requires business_id when the caller is an admin', async () => {
      await expect(
        service.createApiKey(adminUser, { name: 'POS' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ignores business_id from a business user and uses their own business', async () => {
      businessesRepository.findOne.mockResolvedValue({
        id: 'business-1',
        is_active: true,
      });
      subscriptionsService.getCurrentSubscription.mockResolvedValue(
        buildSubscription(),
      );
      apiKeysRepository.count.mockResolvedValue(0);
      apiKeysRepository.create.mockImplementation((data) => data);
      apiKeysRepository.save.mockImplementation(async (data) => ({
        id: 'key-new',
        ...data,
      }));

      const result = await service.createApiKey(businessUser, {
        name: 'POS',
        business_id: 'business-2',
      });

      expect(businessesRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'business-1' },
      });
      expect(result.business_id).toBe('business-1');
      expect(
        subscriptionsService.assignOrChangePackage,
      ).not.toHaveBeenCalled();
    });

    it('assigns a package first when an admin provides package_id', async () => {
      businessesRepository.findOne.mockResolvedValue({
        id: 'business-1',
        is_active: true,
      });
      subscriptionsService.getCurrentSubscription.mockResolvedValue(
        buildSubscription(),
      );
      apiKeysRepository.count.mockResolvedValue(0);
      apiKeysRepository.create.mockImplementation((data) => data);
      apiKeysRepository.save.mockImplementation(async (data) => ({
        id: 'key-new',
        ...data,
      }));

      await service.createApiKey(adminUser, {
        name: 'POS',
        business_id: 'business-1',
        package_id: 'package-2',
      });

      expect(
        subscriptionsService.assignOrChangePackage,
      ).toHaveBeenCalledWith('business-1', 'package-2');
    });
  });

  describe('findAll', () => {
    it('scopes business users to their own business', async () => {
      apiKeysRepository.find.mockResolvedValue([buildApiKey()]);

      const result = await service.findAll(businessUser, 'other-business');

      expect(apiKeysRepository.find).toHaveBeenCalledWith({
        where: { business_id: 'business-1' },
        order: { created_at: 'DESC' },
      });
      expect(result[0]).not.toHaveProperty('key_hash');
    });

    it('allows admins to list all keys or filter by business', async () => {
      apiKeysRepository.find.mockResolvedValue([]);

      await service.findAll(adminUser);
      await service.findAll(adminUser, 'business-2');

      expect(apiKeysRepository.find).toHaveBeenNthCalledWith(1, {
        where: {},
        order: { created_at: 'DESC' },
      });
      expect(apiKeysRepository.find).toHaveBeenNthCalledWith(2, {
        where: { business_id: 'business-2' },
        order: { created_at: 'DESC' },
      });
    });
  });

  describe('updateStatusOrName', () => {
    it('clears the refresh token hash when deactivating a key', async () => {
      const apiKey = buildApiKey();
      apiKeysRepository.findOne.mockResolvedValue(apiKey);
      apiKeysRepository.save.mockImplementation(async (data) => data);

      const result = await service.updateStatusOrName(businessUser, 'key-1', {
        is_active: false,
      });

      expect(apiKeysRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          is_active: false,
          refresh_token_hash: null,
        }),
      );
      expect(result.is_active).toBe(false);
    });

    it('hides keys that belong to another business', async () => {
      apiKeysRepository.findOne.mockResolvedValue(
        buildApiKey({ business_id: 'business-2' }),
      );

      await expect(
        service.updateStatusOrName(businessUser, 'key-1', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('revokeApiKey', () => {
    it('deactivates, clears refresh hash and soft-deletes the key', async () => {
      const apiKey = buildApiKey();
      apiKeysRepository.findOne.mockResolvedValue(apiKey);
      apiKeysRepository.save.mockResolvedValue(apiKey);
      apiKeysRepository.softRemove.mockResolvedValue(apiKey);

      const result = await service.revokeApiKey(businessUser, 'key-1');

      expect(apiKeysRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          is_active: false,
          refresh_token_hash: null,
        }),
      );
      expect(apiKeysRepository.softRemove).toHaveBeenCalledWith(apiKey);
      expect(result).toEqual({ id: 'key-1', revoked: true });
    });
  });

  describe('getKeyUsage', () => {
    it('returns usage counters and recent logs including soft-deleted keys', async () => {
      apiKeysRepository.findOne.mockResolvedValue(
        buildApiKey({ deleted_at: NOW, is_active: false }),
      );
      usageLogsRepository.count
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(9)
        .mockResolvedValueOnce(4);
      usageLogsRepository.find.mockResolvedValue([
        {
          id: 'log-1',
          action: 'QR_PAID',
          payment_order_id: 'order-1',
          quota_deducted: true,
          created_at: NOW,
        },
      ]);

      const result = await service.getKeyUsage(businessUser, 'key-1');

      expect(apiKeysRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'key-1' },
        withDeleted: true,
      });
      expect(result.total_qr_created).toBe(12);
      expect(result.total_qr_paid_and_deducted).toBe(9);
      expect(result.current_hour_requests).toBe(4);
      expect(result.recent_logs[0]).toMatchObject({ action: 'QR_PAID' });
    });

    it('rejects access to another business key', async () => {
      apiKeysRepository.findOne.mockResolvedValue(
        buildApiKey({ business_id: 'business-2' }),
      );

      await expect(
        service.getKeyUsage(businessUser, 'key-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getBusinessUsage', () => {
    it('delegates to the subscriptions service for admins', async () => {
      const usage = { business_id: 'business-1', keys_breakdown: [] };
      subscriptionsService.getBusinessUsage.mockResolvedValue(usage);

      const result = await service.getBusinessUsage(adminUser, 'business-1');

      expect(subscriptionsService.getBusinessUsage).toHaveBeenCalledWith(
        'business-1',
      );
      expect(result).toBe(usage);
    });

    it('rejects a business user requesting another business usage', async () => {
      await expect(
        service.getBusinessUsage(businessUser, 'business-2'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
