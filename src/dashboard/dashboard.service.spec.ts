import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ApiKey } from '../api-keys/entities/api-key.entity';
import { ApiKeyUsageLog } from '../api-keys/entities/api-key-usage-log.entity';
import { AuthUser } from '../auth/types/auth-user.type';
import { Business } from '../business/entities/business.entity';
import { Package } from '../packages/entities/package.entity';
import { PaymentOrder } from '../payment/entities/payment-order.entity';
import { BusinessSubscription } from '../subscriptions/entities/business-subscription.entity';
import { SubscriptionPeriod } from '../subscriptions/entities/subscription-period.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WebhookLog } from '../webhook/entities/webhook-log.entity';
import { DashboardService } from './dashboard.service';

const NOW = new Date('2026-10-20T10:00:00.000Z');

function createRepositoryMock() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
  };
}

const BUSINESS_USER: AuthUser = {
  userId: 'user-biz-1',
  username: 'coffee',
  role: 'business',
  businessId: 'biz-1',
};

const ADMIN_USER: AuthUser = {
  userId: 'user-admin',
  username: 'admin',
  role: 'admin',
  businessId: null,
};

describe('DashboardService', () => {
  let service: DashboardService;
  let paymentOrdersRepository: ReturnType<typeof createRepositoryMock>;
  let usageLogsRepository: ReturnType<typeof createRepositoryMock>;
  let apiKeysRepository: ReturnType<typeof createRepositoryMock>;
  let subscriptionsRepository: ReturnType<typeof createRepositoryMock>;
  let periodsRepository: ReturnType<typeof createRepositoryMock>;
  let packagesRepository: ReturnType<typeof createRepositoryMock>;
  let businessesRepository: ReturnType<typeof createRepositoryMock>;
  let webhookLogsRepository: ReturnType<typeof createRepositoryMock>;
  let subscriptionsService: { getCurrentSubscription: jest.Mock };

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    paymentOrdersRepository = createRepositoryMock();
    usageLogsRepository = createRepositoryMock();
    apiKeysRepository = createRepositoryMock();
    subscriptionsRepository = createRepositoryMock();
    periodsRepository = createRepositoryMock();
    packagesRepository = createRepositoryMock();
    businessesRepository = createRepositoryMock();
    webhookLogsRepository = createRepositoryMock();
    subscriptionsService = {
      getCurrentSubscription: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        {
          provide: getRepositoryToken(PaymentOrder),
          useValue: paymentOrdersRepository,
        },
        {
          provide: getRepositoryToken(ApiKeyUsageLog),
          useValue: usageLogsRepository,
        },
        { provide: getRepositoryToken(ApiKey), useValue: apiKeysRepository },
        {
          provide: getRepositoryToken(BusinessSubscription),
          useValue: subscriptionsRepository,
        },
        {
          provide: getRepositoryToken(SubscriptionPeriod),
          useValue: periodsRepository,
        },
        { provide: getRepositoryToken(Package), useValue: packagesRepository },
        {
          provide: getRepositoryToken(Business),
          useValue: businessesRepository,
        },
        {
          provide: getRepositoryToken(WebhookLog),
          useValue: webhookLogsRepository,
        },
        { provide: SubscriptionsService, useValue: subscriptionsService },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('scope resolution', () => {
    it('forbids a business user from querying another business_id (404)', async () => {
      await expect(
        service.getOverview(BUSINESS_USER, { business_id: 'biz-other' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('requires business_id when called by admin', async () => {
      await expect(service.getOverview(ADMIN_USER, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws 404 when the target business does not exist', async () => {
      businessesRepository.findOne.mockResolvedValue(null);
      subscriptionsService.getCurrentSubscription.mockResolvedValue(null);

      await expect(
        service.getOverview(ADMIN_USER, { business_id: 'biz-missing' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getOverview', () => {
    it('computes overview KPIs, active/expired orders, and matched webhooks', async () => {
      businessesRepository.findOne.mockResolvedValue({
        id: 'biz-1',
        business_name: 'Coffee Shop',
      });
      subscriptionsService.getCurrentSubscription.mockResolvedValue({
        id: 'sub-1',
        business_id: 'biz-1',
        package_id: 'pkg-1',
        status: 'ACTIVE',
        quota_limit: 1000,
        quota_used: 120,
        quota_remaining: 880,
        rate_limit_per_hour: 300,
        max_api_keys: 3,
        current_period_start: new Date('2026-10-01T00:00:00.000Z'),
        current_period_end: new Date('2026-10-30T10:00:00.000Z'),
        last_payment_at: new Date('2026-10-01T00:00:00.000Z'),
      });
      packagesRepository.findOne.mockResolvedValue({
        id: 'pkg-1',
        code: 'STARTER',
        name: 'Starter',
      });
      usageLogsRepository.find.mockResolvedValue([
        {
          action: 'QR_CREATED',
          quota_deducted: false,
          created_at: new Date('2026-10-10T01:00:00.000Z'),
        },
        {
          action: 'QR_CREATED',
          quota_deducted: false,
          created_at: new Date('2026-10-11T01:00:00.000Z'),
        },
        {
          action: 'QR_PAID',
          quota_deducted: true,
          created_at: new Date('2026-10-11T01:02:00.000Z'),
        },
      ]);
      paymentOrdersRepository.find.mockResolvedValue([
        {
          id: 'ord-paid',
          business_id: 'biz-1',
          status: 'PAID',
          total_amount: 100.25,
          created_at: new Date('2026-10-11T01:00:00.000Z'),
          paid_at: new Date('2026-10-11T01:02:00.000Z'),
          expires_at: new Date('2026-10-11T01:05:00.000Z'),
        },
        {
          id: 'ord-lazy-expired',
          business_id: 'biz-1',
          status: 'UNVERIFIED',
          total_amount: 50.01,
          created_at: new Date('2026-10-12T01:00:00.000Z'),
          paid_at: null,
          expires_at: new Date('2026-10-12T01:05:00.000Z'), // <= NOW
        },
        {
          id: 'ord-active-unverified',
          business_id: 'biz-1',
          status: 'UNVERIFIED',
          total_amount: 75.01,
          created_at: new Date('2026-10-20T09:58:00.000Z'),
          paid_at: null,
          expires_at: new Date('2026-10-20T10:03:00.000Z'), // > NOW
        },
      ]);
      apiKeysRepository.find.mockResolvedValue([
        { id: 'k1', is_active: true },
        { id: 'k2', is_active: false },
      ]);
      usageLogsRepository.count.mockResolvedValue(15);
      webhookLogsRepository.find.mockResolvedValue([
        {
          process_status: 'MATCHED',
          matched_order_id: 'ord-paid',
          matched_order: { business_id: 'biz-1' },
          created_at: new Date('2026-10-11T01:02:00.000Z'),
        },
        {
          process_status: 'MATCHED',
          matched_order_id: 'ord-other-biz',
          matched_order: { business_id: 'biz-2' },
          created_at: new Date('2026-10-11T01:02:00.000Z'),
        },
      ]);

      const result = await service.getOverview(BUSINESS_USER, {});

      expect(result.business).toEqual({ id: 'biz-1', name: 'Coffee Shop' });
      expect(result.subscription).toMatchObject({
        package_code: 'STARTER',
        days_until_period_end: 10,
      });
      expect(result.usage).toEqual({
        qr_created: 2,
        qr_paid: 1,
        quota_deducted: 1,
        paid_rate: 0.5,
      });
      expect(result.transactions).toEqual({
        orders_created: 3,
        paid_count: 1,
        expired_count: 1,
        active_unverified_count: 1,
        gmv: 100.25,
        average_order_value: 100.25,
        paid_rate: 0.5,
      });
      expect(result.api_keys).toEqual({ used: 2, active: 1, max: 3 });
      expect(result.rate_limit).toEqual({
        requests_last_hour: 15,
        limit: 300,
        remaining: 285,
        utilization: 0.05,
      });
      expect(result.webhook).toEqual({ matched: 1 });
    });

    it('returns subscription = null and zeroed quota/rate metrics when business has no subscription', async () => {
      businessesRepository.findOne.mockResolvedValue({
        id: 'biz-1',
        business_name: 'No Sub Shop',
      });
      subscriptionsService.getCurrentSubscription.mockResolvedValue(null);
      usageLogsRepository.find.mockResolvedValue([]);
      paymentOrdersRepository.find.mockResolvedValue([]);
      apiKeysRepository.find.mockResolvedValue([]);
      usageLogsRepository.count.mockResolvedValue(0);
      webhookLogsRepository.find.mockResolvedValue([]);

      const result = await service.getOverview(BUSINESS_USER, {});

      expect(result.subscription).toBeNull();
      expect(result.rate_limit.limit).toBe(0);
      expect(result.rate_limit.utilization).toBe(0);
      expect(result.transactions.paid_rate).toBe(0);
      expect(result.transactions.average_order_value).toBe(0);
    });
  });

  describe('getUsageTimeseries', () => {
    it('zero-fills buckets and filters by metric and api_key_id', async () => {
      businessesRepository.findOne.mockResolvedValue({
        id: 'biz-1',
        business_name: 'Coffee Shop',
      });
      usageLogsRepository.find.mockResolvedValue([
        {
          api_key_id: 'key-1',
          action: 'QR_CREATED',
          quota_deducted: false,
          created_at: new Date('2026-10-19T18:00:00.000Z'), // 20 Oct Bangkok
        },
      ]);

      const result = await service.getUsageTimeseries(BUSINESS_USER, {
        from: '2026-10-18T17:00:00.000Z', // 19 Oct 00:00 TH
        to: '2026-10-20T17:00:00.000Z', // 21 Oct 00:00 TH
        interval: 'day',
        metric: 'qr_created',
        api_key_id: 'key-1',
      });

      expect(usageLogsRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ api_key_id: 'key-1' }),
        }),
      );
      expect(result.series).toHaveLength(1);
      expect(result.series[0].points).toEqual([
        {
          bucket_start: '2026-10-18T17:00:00.000Z',
          label: '19 Oct',
          value: 0,
        },
        {
          bucket_start: '2026-10-19T17:00:00.000Z',
          label: '20 Oct',
          value: 1,
        },
      ]);
    });
  });

  describe('getTransactionsTimeseries', () => {
    it('builds series for orders, paid, expired, GMV, AOV and status breakdown', async () => {
      businessesRepository.findOne.mockResolvedValue({
        id: 'biz-1',
        business_name: 'Coffee Shop',
      });
      paymentOrdersRepository.find.mockResolvedValue([
        {
          id: 'o1',
          business_id: 'biz-1',
          status: 'PAID',
          total_amount: '200.50',
          created_at: new Date('2026-10-19T18:00:00.000Z'),
          paid_at: new Date('2026-10-19T18:01:00.000Z'),
          expires_at: new Date('2026-10-19T18:05:00.000Z'),
        },
        {
          id: 'o2',
          business_id: 'biz-1',
          status: 'UNVERIFIED',
          total_amount: '100.00',
          created_at: new Date('2026-10-19T19:00:00.000Z'),
          paid_at: null,
          expires_at: new Date('2026-10-19T19:05:00.000Z'), // expired
        },
      ]);

      const result = await service.getTransactionsTimeseries(BUSINESS_USER, {
        from: '2026-10-19T17:00:00.000Z',
        to: '2026-10-20T17:00:00.000Z',
        interval: 'day',
      });

      const gmvSeries = result.series.find((s) => s.key === 'gmv');
      const aovSeries = result.series.find(
        (s) => s.key === 'average_order_value',
      );
      expect(gmvSeries?.points[0].value).toBe(200.5);
      expect(aovSeries?.points[0].value).toBe(200.5);
      expect(result.status_breakdown).toEqual({
        PAID: 1,
        UNVERIFIED: { active: 0, expired: 1 },
        EXPIRED: 0,
      });
    });
  });

  describe('getRateLimitStatus', () => {
    it('clamps utilization to 1 and returns hourly series', async () => {
      businessesRepository.findOne.mockResolvedValue({
        id: 'biz-1',
        business_name: 'Coffee Shop',
      });
      subscriptionsService.getCurrentSubscription.mockResolvedValue({
        rate_limit_per_hour: 10,
      });
      usageLogsRepository.count.mockResolvedValue(25);
      usageLogsRepository.find.mockResolvedValue([]);

      const result = await service.getRateLimitStatus(BUSINESS_USER, {
        hours: 6,
      });

      expect(result.requests_last_hour).toBe(25);
      expect(result.limit_per_hour).toBe(10);
      expect(result.remaining).toBe(0);
      expect(result.utilization).toBe(1);
      expect(result.series).toHaveLength(6);
    });
  });

  describe('getApiKeyBreakdown & getApiKeyTimeseries', () => {
    it('includes soft-deleted keys in breakdown and handles zero totals safely', async () => {
      businessesRepository.findOne.mockResolvedValue({
        id: 'biz-1',
        business_name: 'Coffee Shop',
      });
      subscriptionsService.getCurrentSubscription.mockResolvedValue({
        max_api_keys: 5,
      });
      apiKeysRepository.find.mockResolvedValue([
        {
          id: 'k-active',
          name: 'POS 1',
          key_prefix: 'apay_live_11111111',
          is_active: true,
          deleted_at: null,
          created_at: NOW,
          last_used_at: NOW,
        },
        {
          id: 'k-deleted',
          name: 'Old POS',
          key_prefix: 'apay_live_22222222',
          is_active: false,
          deleted_at: NOW,
          created_at: NOW,
          last_used_at: null,
        },
      ]);
      usageLogsRepository.find.mockResolvedValue([]);

      const result = await service.getApiKeyBreakdown(BUSINESS_USER, {});

      expect(result.summary).toEqual({
        total_keys: 2,
        active_keys: 1,
        revoked_keys: 1,
        max_api_keys: 5,
      });
      expect(result.keys[0].share_of_created).toBe(0);
      expect(result.keys[1].deleted_at).not.toBeNull();
    });

    it('caps timeseries to top 10 keys and aggregates the rest into "other"', async () => {
      businessesRepository.findOne.mockResolvedValue({
        id: 'biz-1',
        business_name: 'Coffee Shop',
      });
      const keys = Array.from({ length: 12 }, (_, idx) => ({
        id: `key-${idx + 1}`,
        name: `Key ${idx + 1}`,
        key_prefix: `apay_live_${String(idx + 1).padStart(8, '0')}`,
        is_active: true,
        deleted_at: null,
        created_at: NOW,
      }));
      apiKeysRepository.find.mockResolvedValue(keys);
      usageLogsRepository.find.mockResolvedValue(
        keys.map((k) => ({
          api_key_id: k.id,
          action: 'QR_CREATED',
          quota_deducted: false,
          created_at: new Date('2026-10-19T18:00:00.000Z'),
        })),
      );

      const result = await service.getApiKeyTimeseries(BUSINESS_USER, {
        from: '2026-10-19T17:00:00.000Z',
        to: '2026-10-20T17:00:00.000Z',
        interval: 'day',
      });

      expect(result.series).toHaveLength(11);
      const other = result.series[10];
      expect(other.key).toBe('other');
      expect(other.points[0].value).toBe(2);
    });
  });

  describe('getSubscriptionTrend', () => {
    it('computes daily cumulative quota burn-down and clamps remaining at 0', async () => {
      businessesRepository.findOne.mockResolvedValue({
        id: 'biz-1',
        business_name: 'Coffee Shop',
      });
      subscriptionsService.getCurrentSubscription.mockResolvedValue({
        id: 'sub-1',
        business_id: 'biz-1',
        package_id: 'pkg-1',
        status: 'ACTIVE',
        quota_limit: 2,
        quota_used: 3,
        quota_remaining: 0,
        rate_limit_per_hour: 100,
        max_api_keys: 2,
        current_period_start: new Date('2026-10-18T17:00:00.000Z'), // 19 Oct TH
        current_period_end: new Date('2026-11-18T17:00:00.000Z'),
        last_payment_at: new Date('2026-10-18T17:00:00.000Z'),
      });
      packagesRepository.findOne.mockResolvedValue({
        id: 'pkg-1',
        code: 'FREE',
        name: 'Free',
      });
      periodsRepository.find.mockResolvedValue([
        {
          id: 'per-1',
          subscription_id: 'sub-1',
          business_id: 'biz-1',
          package_id: 'pkg-1',
          period_start: new Date('2026-09-18T17:00:00.000Z'),
          period_end: new Date('2026-10-18T17:00:00.000Z'),
          quota_limit: 100,
          quota_used: 50,
          created_at: new Date('2026-10-18T17:00:00.000Z'),
        },
      ]);
      usageLogsRepository.find.mockResolvedValue([
        {
          action: 'QR_PAID',
          quota_deducted: true,
          created_at: new Date('2026-10-18T18:00:00.000Z'), // 19 Oct
        },
        {
          action: 'QR_PAID',
          quota_deducted: true,
          created_at: new Date('2026-10-19T18:00:00.000Z'), // 20 Oct
        },
        {
          action: 'QR_PAID',
          quota_deducted: true,
          created_at: new Date('2026-10-19T19:00:00.000Z'), // 20 Oct
        },
      ]);

      const result = await service.getSubscriptionTrend(BUSINESS_USER, {});

      expect(result.quota.daily).toEqual([
        {
          bucket_start: '2026-10-18T17:00:00.000Z',
          label: '19 Oct',
          quota_deducted: 1,
          cumulative_used: 1,
          quota_remaining: 1,
        },
        {
          bucket_start: '2026-10-19T17:00:00.000Z',
          label: '20 Oct',
          quota_deducted: 2,
          cumulative_used: 3,
          quota_remaining: 0,
        },
      ]);
      expect(result.periods[0].utilization).toBe(0.5);
    });
  });

  describe('Admin endpoints', () => {
    it('computes getAdminOverview including Estimated MRR/ARR and webhook match_rate', async () => {
      businessesRepository.find.mockResolvedValue([
        {
          id: 'b1',
          is_active: true,
          created_at: new Date('2026-10-15T00:00:00.000Z'),
        },
        {
          id: 'b2',
          is_active: false,
          created_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);
      packagesRepository.find.mockResolvedValue([
        { id: 'pkg-pro', price: 1500 },
      ]);
      subscriptionsRepository.find.mockResolvedValue([
        {
          id: 's1',
          package_id: 'pkg-pro',
          status: 'ACTIVE',
          current_period_end: new Date('2026-10-25T00:00:00.000Z'), // within 7d
          deleted_at: null,
        },
        {
          id: 's2',
          package_id: 'pkg-pro',
          status: 'PAST_DUE',
          current_period_end: new Date('2026-10-01T00:00:00.000Z'),
          deleted_at: null,
        },
      ]);
      paymentOrdersRepository.find.mockResolvedValue([]);
      usageLogsRepository.find.mockResolvedValue([]);
      webhookLogsRepository.find.mockResolvedValue([
        {
          process_status: 'MATCHED',
          created_at: new Date('2026-10-15T00:00:00.000Z'),
        },
        {
          process_status: 'NO_MATCH',
          created_at: new Date('2026-10-15T00:00:00.000Z'),
        },
      ]);

      const result = await service.getAdminOverview({});

      expect(result.businesses).toEqual({
        total: 2,
        active: 1,
        new_in_range: 1,
      });
      expect(result.subscriptions).toEqual({
        active: 1,
        past_due: 1,
        cancelled: 0,
        expiring_7d: 1,
        expiring_30d: 1,
      });
      expect(result.webhook).toEqual({
        matched: 1,
        no_match: 1,
        match_rate: 0.5,
      });
      expect(result.estimated_mrr).toBe(1500);
      expect(result.estimated_arr).toBe(18000);
    });

    it('returns equal-length series in getAdminTimeseries', async () => {
      businessesRepository.find.mockResolvedValue([]);
      paymentOrdersRepository.find.mockResolvedValue([]);
      usageLogsRepository.find.mockResolvedValue([]);

      const result = await service.getAdminTimeseries({
        from: '2026-10-18T17:00:00.000Z',
        to: '2026-10-20T17:00:00.000Z',
        interval: 'day',
      });

      expect(result.series).toHaveLength(6);
      for (const s of result.series) {
        expect(s.points).toHaveLength(2);
      }
    });

    it('groups packages, statuses, and quota utilization buckets in getAdminDistribution', async () => {
      packagesRepository.find.mockResolvedValue([
        { id: 'pkg-1', code: 'FREE', name: 'Free', price: 0 },
        { id: 'pkg-2', code: 'PRO', name: 'Pro', price: 1999 },
      ]);
      subscriptionsRepository.find.mockResolvedValue([
        {
          package_id: 'pkg-1',
          status: 'ACTIVE',
          quota_limit: 100,
          quota_used: 80,
          deleted_at: null,
        },
      ]);

      const result = await service.getAdminDistribution({});

      expect(result.packages).toEqual([
        {
          package_id: 'pkg-1',
          code: 'FREE',
          name: 'Free',
          price: 0,
          business_count: 1,
          active_count: 1,
          past_due_count: 0,
        },
        {
          package_id: 'pkg-2',
          code: 'PRO',
          name: 'Pro',
          price: 1999,
          business_count: 0,
          active_count: 0,
          past_due_count: 0,
        },
      ]);
      const bucket76 = result.quota_utilization.find(
        (b) => b.bucket === '76-100',
      );
      expect(bucket76?.count).toBe(1);
    });

    it('filters, sorts, and paginates businesses in getAdminBusinesses (including businesses without subscription)', async () => {
      businessesRepository.find.mockResolvedValue([
        {
          id: 'b1',
          business_name: 'Alpha Cafe',
          created_at: new Date('2026-10-01T00:00:00.000Z'),
        },
        {
          id: 'b2',
          business_name: 'Beta Bakery',
          created_at: new Date('2026-10-02T00:00:00.000Z'),
        },
      ]);
      subscriptionsRepository.find.mockResolvedValue([
        {
          id: 's1',
          business_id: 'b1',
          package_id: 'pkg-1',
          status: 'ACTIVE',
          quota_limit: 100,
          quota_used: 10,
          quota_remaining: 90,
          max_api_keys: 3,
          current_period_end: new Date('2026-11-01T00:00:00.000Z'),
          last_payment_at: new Date('2026-10-01T00:00:00.000Z'),
          deleted_at: null,
        },
      ]);
      packagesRepository.find.mockResolvedValue([
        { id: 'pkg-1', code: 'STARTER', name: 'Starter' },
      ]);
      apiKeysRepository.find.mockResolvedValue([]);
      usageLogsRepository.find.mockResolvedValue([]);
      paymentOrdersRepository.find.mockResolvedValue([
        {
          business_id: 'b2',
          status: 'PAID',
          total_amount: 500,
          paid_at: new Date('2026-10-15T00:00:00.000Z'),
        },
      ]);

      const result = await service.getAdminBusinesses({
        sort_by: 'gmv',
        sort_order: 'desc',
        page: 1,
        limit: 10,
      });

      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 2,
        total_pages: 1,
      });
      expect(result.items[0].business_id).toBe('b2');
      expect(result.items[0].subscription_status).toBeNull();
      expect(result.items[1].business_id).toBe('b1');
      expect(result.items[1].package_code).toBe('STARTER');
    });

    it('returns expiring and near_quota subscriptions in getAdminExpiring', async () => {
      businessesRepository.find.mockResolvedValue([
        { id: 'b1', business_name: 'Shop 1' },
      ]);
      subscriptionsRepository.find.mockResolvedValue([
        {
          id: 's1',
          business_id: 'b1',
          status: 'ACTIVE',
          quota_limit: 100,
          quota_used: 90,
          quota_remaining: 10,
          current_period_end: new Date('2026-10-23T10:00:00.000Z'),
          deleted_at: null,
        },
      ]);

      const result = await service.getAdminExpiring({
        days: 7,
        quota_threshold: 0.8,
      });

      expect(result.expiring).toHaveLength(1);
      expect(result.expiring[0].days_remaining).toBe(3);
      expect(result.near_quota).toHaveLength(1);
      expect(result.near_quota[0].utilization).toBe(0.9);
    });
  });
});
