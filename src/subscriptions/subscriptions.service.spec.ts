import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiKey } from '../api-keys/entities/api-key.entity';
import { ApiKeyUsageLog } from '../api-keys/entities/api-key-usage-log.entity';
import { Business } from '../business/entities/business.entity';
import { addMonthsClamped } from '../common/utils/datetime.util';
import { Package } from '../packages/entities/package.entity';
import { PaymentOrder } from '../payment/entities/payment-order.entity';
import { BusinessSubscription } from './entities/business-subscription.entity';
import { SubscriptionPeriod } from './entities/subscription-period.entity';
import { SubscriptionsService } from './subscriptions.service';

const NOW = new Date('2026-10-20T10:00:00.000Z');

function createRepositoryMock() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(async (value: unknown) => value),
    create: jest.fn((value: unknown) => value),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
    manager: undefined as unknown,
  };
}

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
    rate_limit_per_hour: 5,
    max_api_keys: 2,
    current_period_start: new Date('2026-09-20T10:00:00.000Z'),
    current_period_end: new Date('2026-11-20T10:00:00.000Z'),
    cancelled_at: null,
    last_payment_at: new Date('2026-09-20T10:00:00.000Z'),
    deleted_at: null,
    created_at: new Date('2026-09-20T10:00:00.000Z'),
    updated_at: new Date('2026-09-20T10:00:00.000Z'),
    ...overrides,
  } as BusinessSubscription;
}

function buildPackage(overrides: Partial<Package> = {}): Package {
  return {
    id: 'package-1',
    code: 'STARTER',
    name: 'Starter',
    description: null,
    price: 499,
    max_api_keys: 3,
    quota_limit: 1000,
    rate_limit_per_hour: 300,
    billing_cycle_months: 1,
    is_active: true,
    ...overrides,
  } as Package;
}

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;

  let subscriptionsRepository: ReturnType<typeof createRepositoryMock>;
  let periodsRepository: ReturnType<typeof createRepositoryMock>;
  let packagesRepository: ReturnType<typeof createRepositoryMock>;
  let businessesRepository: ReturnType<typeof createRepositoryMock>;
  let apiKeysRepository: ReturnType<typeof createRepositoryMock>;
  let usageLogsRepository: ReturnType<typeof createRepositoryMock>;
  let queryBuilder: {
    setLock: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    getOne: jest.Mock;
  };
  let manager: { getRepository: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    subscriptionsRepository = createRepositoryMock();
    periodsRepository = createRepositoryMock();
    packagesRepository = createRepositoryMock();
    businessesRepository = createRepositoryMock();
    apiKeysRepository = createRepositoryMock();
    usageLogsRepository = createRepositoryMock();

    const repositoryMap = new Map<unknown, unknown>([
      [BusinessSubscription, subscriptionsRepository],
      [SubscriptionPeriod, periodsRepository],
      [Package, packagesRepository],
      [Business, businessesRepository],
      [ApiKey, apiKeysRepository],
      [ApiKeyUsageLog, usageLogsRepository],
    ]);

    manager = {
      getRepository: jest.fn((entity: unknown) => repositoryMap.get(entity)),
    };

    subscriptionsRepository.manager = manager;

    queryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };

    subscriptionsRepository.createQueryBuilder.mockReturnValue(queryBuilder);

    dataSource = {
      transaction: jest.fn(async (callback: (m: unknown) => unknown) =>
        callback(manager),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsService,
        {
          provide: getRepositoryToken(BusinessSubscription),
          useValue: subscriptionsRepository,
        },
        {
          provide: getRepositoryToken(SubscriptionPeriod),
          useValue: periodsRepository,
        },
        { provide: getRepositoryToken(Package), useValue: packagesRepository },
        { provide: getRepositoryToken(Business), useValue: businessesRepository },
        { provide: getRepositoryToken(ApiKey), useValue: apiKeysRepository },
        {
          provide: getRepositoryToken(ApiKeyUsageLog),
          useValue: usageLogsRepository,
        },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<SubscriptionsService>(SubscriptionsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('assignOrChangePackage', () => {
    it('maps the package to the subscription and resets the quota', async () => {
      const subscription = buildSubscription({ quota_used: 25 });
      const pkg = buildPackage();

      businessesRepository.findOne.mockResolvedValue({
        id: 'business-1',
        is_active: true,
      });
      packagesRepository.findOne.mockResolvedValue(pkg);
      subscriptionsRepository.findOne.mockResolvedValue(subscription);

      const result = await service.assignOrChangePackage(
        'business-1',
        'package-1',
      );

      expect(periodsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription_id: 'sub-1',
          quota_used: 25,
        }),
      );
      expect(subscriptionsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ACTIVE',
          package_id: 'package-1',
          quota_limit: 1000,
          quota_used: 0,
          quota_remaining: 1000,
          rate_limit_per_hour: 300,
          max_api_keys: 3,
          current_period_start: NOW,
          current_period_end: addMonthsClamped(NOW, 1),
          last_payment_at: NOW,
        }),
      );
      expect(result.quota_remaining).toBe(1000);
    });

    it('does not snapshot when no quota has been used yet', async () => {
      businessesRepository.findOne.mockResolvedValue({
        id: 'business-1',
        is_active: true,
      });
      packagesRepository.findOne.mockResolvedValue(buildPackage());
      subscriptionsRepository.findOne.mockResolvedValue(
        buildSubscription({ quota_used: 0 }),
      );

      await service.assignOrChangePackage('business-1', 'package-1');

      expect(periodsRepository.save).not.toHaveBeenCalled();
    });

    it('joins a caller-provided transaction instead of opening a new one', async () => {
      businessesRepository.findOne.mockResolvedValue({
        id: 'business-1',
        is_active: true,
      });
      packagesRepository.findOne.mockResolvedValue(buildPackage());
      subscriptionsRepository.findOne.mockResolvedValue(
        buildSubscription({ quota_used: 0 }),
      );

      await service.assignOrChangePackage(
        'business-1',
        'package-1',
        manager as any,
      );

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(manager.getRepository).toHaveBeenCalledWith(Business);
      expect(manager.getRepository).toHaveBeenCalledWith(Package);
      expect(subscriptionsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ package_id: 'package-1', status: 'ACTIVE' }),
      );
    });

    it('throws when the business does not exist', async () => {
      businessesRepository.findOne.mockResolvedValue(null);

      await expect(
        service.assignOrChangePackage('missing', 'package-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when the package is inactive', async () => {
      businessesRepository.findOne.mockResolvedValue({
        id: 'business-1',
        is_active: true,
      });
      packagesRepository.findOne.mockResolvedValue(
        buildPackage({ is_active: false }),
      );

      await expect(
        service.assignOrChangePackage('business-1', 'package-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('expireIfPastDue (lazy expiry)', () => {
    it('leaves an active subscription untouched before the paid-through date', async () => {
      const subscription = buildSubscription({
        current_period_end: new Date('2026-11-20T10:00:00.000Z'),
      });

      const result = await (service as any).expireIfPastDue(subscription);

      expect(result).toBe(subscription);
      expect(result.status).toBe('ACTIVE');
      expect(periodsRepository.save).not.toHaveBeenCalled();
      expect(subscriptionsRepository.save).not.toHaveBeenCalled();
    });

    it('marks the subscription PAST_DUE with zero remaining quota and snapshots the period', async () => {
      const subscription = buildSubscription({
        current_period_end: new Date('2026-10-20T10:00:00.000Z'),
      });

      const result = await (service as any).expireIfPastDue(subscription);

      expect(periodsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          subscription_id: 'sub-1',
          business_id: 'business-1',
          quota_limit: 100,
          quota_used: 10,
        }),
      );
      expect(result.status).toBe('PAST_DUE');
      expect(result.quota_remaining).toBe(0);
      expect(result.quota_used).toBe(10);
      expect(subscriptionsRepository.save).toHaveBeenCalled();
    });
  });

  describe('renewSubscription', () => {
    it('keeps the existing paid-through date when renewing early', async () => {
      const subscription = buildSubscription({
        current_period_end: new Date('2026-11-20T10:00:00.000Z'),
      });

      subscriptionsRepository.findOne.mockResolvedValue(subscription);
      packagesRepository.findOne.mockResolvedValue(buildPackage());

      await service.renewSubscription('sub-1');

      expect(subscriptionsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ACTIVE',
          quota_used: 0,
          quota_remaining: 1000,
          current_period_start: new Date('2026-11-20T10:00:00.000Z'),
          current_period_end: new Date('2026-12-20T10:00:00.000Z'),
          last_payment_at: NOW,
        }),
      );
    });

    it('starts a new period at now when the subscription is already past due', async () => {
      const subscription = buildSubscription({
        status: 'PAST_DUE',
        quota_remaining: 0,
        current_period_end: new Date('2026-10-01T10:00:00.000Z'),
      });

      subscriptionsRepository.findOne.mockResolvedValue(subscription);
      packagesRepository.findOne.mockResolvedValue(buildPackage());

      await service.renewSubscription('sub-1');

      expect(subscriptionsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ACTIVE',
          current_period_start: NOW,
          current_period_end: new Date('2026-11-20T10:00:00.000Z'),
        }),
      );
    });

    it('throws when the subscription does not exist', async () => {
      subscriptionsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.renewSubscription('missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when the subscription is cancelled', async () => {
      subscriptionsRepository.findOne.mockResolvedValue(
        buildSubscription({ status: 'CANCELLED' }),
      );

      await expect(
        service.renewSubscription('sub-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws when changing to an inactive package', async () => {
      subscriptionsRepository.findOne.mockResolvedValue(buildSubscription());
      packagesRepository.findOne.mockResolvedValue(
        buildPackage({ is_active: false }),
      );

      await expect(
        service.renewSubscription('sub-1', 'package-2'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('assertQuotaAndRateLimit', () => {
    it('throws 403 when the business has no subscription', async () => {
      subscriptionsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.assertQuotaAndRateLimit('business-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws 403 when the subscription is PAST_DUE', async () => {
      subscriptionsRepository.findOne.mockResolvedValue(
        buildSubscription({ status: 'PAST_DUE', quota_remaining: 0 }),
      );

      await expect(
        service.assertQuotaAndRateLimit('business-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws 429 when the monthly quota is exhausted', async () => {
      subscriptionsRepository.findOne.mockResolvedValue(
        buildSubscription({ quota_remaining: 0 }),
      );

      await expect(
        service.assertQuotaAndRateLimit('business-1'),
      ).rejects.toMatchObject({ status: 429 });
    });

    it('throws 429 when the hourly rate limit is reached', async () => {
      subscriptionsRepository.findOne.mockResolvedValue(buildSubscription());
      usageLogsRepository.count.mockResolvedValue(5);

      await expect(
        service.assertQuotaAndRateLimit('business-1'),
      ).rejects.toBeInstanceOf(HttpException);
    });

    it('passes when the subscription is active and within limits', async () => {
      const subscription = buildSubscription();
      subscriptionsRepository.findOne.mockResolvedValue(subscription);
      usageLogsRepository.count.mockResolvedValue(4);

      const result = await service.assertQuotaAndRateLimit('business-1');

      expect(result).toBe(subscription);
      expect(usageLogsRepository.count).toHaveBeenCalled();
    });
  });

  describe('deductQuotaOnPaid', () => {
    const order = {
      id: 'order-1',
      business_id: 'business-1',
    } as PaymentOrder;

    it('deducts one quota when the subscription is active', async () => {
      const subscription = buildSubscription();
      queryBuilder.getOne.mockResolvedValue(subscription);

      const result = await service.deductQuotaOnPaid(order, manager as any);

      expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(result).toBe(true);
      expect(subscription.quota_remaining).toBe(89);
      expect(subscription.quota_used).toBe(11);
      expect(subscriptionsRepository.save).toHaveBeenCalledWith(subscription);
    });

    it('does not deduct when quota is already zero', async () => {
      queryBuilder.getOne.mockResolvedValue(
        buildSubscription({ quota_remaining: 0 }),
      );

      const result = await service.deductQuotaOnPaid(order, manager as any);

      expect(result).toBe(false);
      expect(subscriptionsRepository.save).not.toHaveBeenCalled();
    });

    it('does not deduct when the subscription is not active', async () => {
      queryBuilder.getOne.mockResolvedValue(
        buildSubscription({ status: 'PAST_DUE', quota_remaining: 0 }),
      );

      const result = await service.deductQuotaOnPaid(order, manager as any);

      expect(result).toBe(false);
      expect(subscriptionsRepository.save).not.toHaveBeenCalled();
    });

    it('does not deduct when the business has no subscription', async () => {
      queryBuilder.getOne.mockResolvedValue(null);

      const result = await service.deductQuotaOnPaid(order, manager as any);

      expect(result).toBe(false);
    });
  });

  describe('handleHourlyBillingEnforcement (cron)', () => {
    it('expires every subscription past its paid-through date', async () => {
      const expired = buildSubscription({
        current_period_end: new Date('2026-10-20T10:00:00.000Z'),
      });
      subscriptionsRepository.find.mockResolvedValue([expired]);

      await service.handleHourlyBillingEnforcement();

      expect(subscriptionsRepository.find).toHaveBeenCalledWith({
        where: expect.objectContaining({ status: 'ACTIVE' }),
      });
      expect(subscriptionsRepository.save).toHaveBeenCalled();
      expect(expired.status).toBe('PAST_DUE');
    });

    it('continues processing when one subscription fails', async () => {
      const failing = buildSubscription({
        id: 'sub-fail',
        current_period_end: new Date('2026-10-20T10:00:00.000Z'),
      });
      const healthy = buildSubscription({
        id: 'sub-ok',
        current_period_end: new Date('2026-10-20T10:00:00.000Z'),
      });

      subscriptionsRepository.find.mockResolvedValue([failing, healthy]);
      periodsRepository.save
        .mockRejectedValueOnce(new Error('snapshot failed'))
        .mockResolvedValueOnce({});

      await expect(
        service.handleHourlyBillingEnforcement(),
      ).resolves.toBeUndefined();
      expect(subscriptionsRepository.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('usage reporting', () => {
    it('returns subscription details with api key usage counts', async () => {
      subscriptionsRepository.findOne.mockResolvedValue(buildSubscription());
      apiKeysRepository.count.mockResolvedValue(2);
      periodsRepository.find.mockResolvedValue([]);

      const result = await service.getBusinessSubscriptionDetails('business-1');

      expect(result.api_keys).toEqual({ used: 2, max: 2 });
      expect(result.subscription).toMatchObject({
        status: 'ACTIVE',
        quota_remaining: 90,
      });
    });

    it('summarizes usage per api key including soft-deleted keys', async () => {
      subscriptionsRepository.findOne.mockResolvedValue(buildSubscription());
      usageLogsRepository.count
        .mockResolvedValueOnce(3) // current hour requests
        .mockResolvedValueOnce(10) // qr created for key
        .mockResolvedValueOnce(8) // qr paid
        .mockResolvedValueOnce(7); // quota deducted
      apiKeysRepository.find.mockResolvedValue([
        {
          id: 'key-1',
          name: 'POS',
          key_prefix: 'apay_live_1234abcd',
          is_active: false,
          deleted_at: new Date('2026-10-19T00:00:00.000Z'),
          last_used_at: NOW,
        },
      ]);

      const result = await service.getBusinessUsage('business-1');

      expect(result.current_hour_requests).toBe(3);
      expect(result.keys_breakdown[0]).toMatchObject({
        api_key_id: 'key-1',
        qr_created_count: 10,
        qr_paid_count: 8,
        quota_deducted_count: 7,
      });
    });
  });
});
