import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, MoreThanOrEqual, Repository } from 'typeorm';
import { ApiKey } from '../api-keys/entities/api-key.entity';
import { ApiKeyUsageLog } from '../api-keys/entities/api-key-usage-log.entity';
import { AuthUser } from '../auth/types/auth-user.type';
import { Business } from '../business/entities/business.entity';
import {
  AdminBusinessesSortByEnum,
  ApiKeyUsageActionEnum,
  BusinessSubscriptionStatusEnum,
  DashboardIntervalEnum,
  DashboardUsageMetricEnum,
  PaymentOrderStatusEnum,
  RoleEnum,
  SortOrderEnum,
  WebhookProcessStatusEnum,
} from '../enums';
import { Package } from '../packages/entities/package.entity';
import { PaymentOrder } from '../payment/entities/payment-order.entity';
import {
  BusinessSubscription,
  BusinessSubscriptionStatus,
} from '../subscriptions/entities/business-subscription.entity';
import { SubscriptionPeriod } from '../subscriptions/entities/subscription-period.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WebhookLog } from '../webhook/entities/webhook-log.entity';
import { AdminBusinessesQueryDto } from './dto/admin-businesses-query.dto';
import { DashboardApiKeysQueryDto } from './dto/dashboard-api-keys-query.dto';
import { DashboardExpiringQueryDto } from './dto/dashboard-expiring-query.dto';
import { DashboardRangeQueryDto } from './dto/dashboard-range-query.dto';
import {
  DashboardUsageMetric,
  DashboardUsageQueryDto,
} from './dto/dashboard-usage-query.dto';
import {
  AdminBusinessListItem,
  AdminBusinessesResponse,
  AdminDistributionResponse,
  AdminExpiringResponse,
  AdminExpiringSubscriptionItem,
  AdminNearQuotaSubscriptionItem,
  AdminOverviewResponse,
  AdminPackageDistributionItem,
  AdminQuotaUtilizationItem,
  AdminStatusDistributionItem,
  AdminTimeseriesResponse,
  DashboardApiKeyBreakdownItem,
  DashboardApiKeyBreakdownResponse,
  DashboardApiKeyTimeseriesResponse,
  DashboardInterval,
  DashboardOverviewResponse,
  DashboardQuotaDailyPoint,
  DashboardRateLimitResponse,
  DashboardSeries,
  DashboardSeriesPoint,
  DashboardSubscriptionPeriodItem,
  DashboardSubscriptionSummary,
  DashboardSubscriptionTrendResponse,
  DashboardTransactionsTimeseriesResponse,
  DashboardUsageTimeseriesResponse,
  QuotaUtilizationBucket,
} from './types/dashboard.types';
import {
  formatBucketLabel,
  generateBuckets,
  resolveDashboardRange,
  startOfBangkokBucket,
  toDashboardRangeMeta,
} from './utils/dashboard-bucket.util';

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TOP_KEYS = 10;

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(PaymentOrder)
    private readonly paymentOrdersRepository: Repository<PaymentOrder>,
    @InjectRepository(ApiKeyUsageLog)
    private readonly usageLogsRepository: Repository<ApiKeyUsageLog>,
    @InjectRepository(ApiKey)
    private readonly apiKeysRepository: Repository<ApiKey>,
    @InjectRepository(BusinessSubscription)
    private readonly subscriptionsRepository: Repository<BusinessSubscription>,
    @InjectRepository(SubscriptionPeriod)
    private readonly periodsRepository: Repository<SubscriptionPeriod>,
    @InjectRepository(Package)
    private readonly packagesRepository: Repository<Package>,
    @InjectRepository(Business)
    private readonly businessesRepository: Repository<Business>,
    @InjectRepository(WebhookLog)
    private readonly webhookLogsRepository: Repository<WebhookLog>,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  private resolveBusinessId(user: AuthUser, businessId?: string): string {
    if (user.role === RoleEnum.BUSINESS) {
      if (!user.businessId) {
        throw new NotFoundException('Business not found');
      }

      if (businessId && businessId !== user.businessId) {
        throw new NotFoundException('Business not found');
      }

      return user.businessId;
    }

    if (!businessId) {
      throw new BadRequestException('business_id is required for admin');
    }

    return businessId;
  }

  private async getBusinessOrFail(businessId: string): Promise<Business> {
    const business = await this.businessesRepository.findOne({
      where: { id: businessId },
    });

    if (!business) {
      throw new NotFoundException('Business not found');
    }

    return business;
  }

  private async getCurrentSubscriptionOrFail(
    businessId: string,
  ): Promise<BusinessSubscription> {
    const subscription =
      await this.subscriptionsService.getCurrentSubscription(businessId);

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    return subscription;
  }

  private roundMetric(value: number, decimals = 4): number {
    if (!Number.isFinite(value) || value === 0) {
      return 0;
    }

    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  private roundCurrency(value: number): number {
    return this.roundMetric(value, 2);
  }

  private computeDaysUntil(periodEnd: Date, now: Date): number {
    const diffMs = new Date(periodEnd).getTime() - now.getTime();
    if (diffMs <= 0) {
      return 0;
    }

    return Math.max(0, Math.ceil(diffMs / DAY_MS));
  }

  private async buildSubscriptionSummary(
    subscription: BusinessSubscription | null,
    now: Date,
  ): Promise<DashboardSubscriptionSummary | null> {
    if (!subscription) {
      return null;
    }

    const pkg = await this.packagesRepository.findOne({
      where: { id: subscription.package_id },
      withDeleted: true,
    });

    const periodStart = new Date(subscription.current_period_start);
    const periodEnd = new Date(subscription.current_period_end);
    const lastPayment = subscription.last_payment_at
      ? new Date(subscription.last_payment_at).toISOString()
      : null;

    return {
      id: subscription.id,
      package_id: subscription.package_id,
      package_code: pkg?.code ?? null,
      package_name: pkg?.name ?? null,
      status: subscription.status,
      quota_limit: Number(subscription.quota_limit),
      quota_used: Number(subscription.quota_used),
      quota_remaining: Number(subscription.quota_remaining),
      rate_limit_per_hour: Number(subscription.rate_limit_per_hour),
      max_api_keys: Number(subscription.max_api_keys),
      current_period_start: periodStart.toISOString(),
      current_period_end: periodEnd.toISOString(),
      last_payment_at: lastPayment,
      days_until_period_end: this.computeDaysUntil(periodEnd, now),
    };
  }

  private isInHalfOpenRange(date: Date | null | undefined, from: Date, to: Date): boolean {
    if (!date) {
      return false;
    }
    const time = new Date(date).getTime();
    return time >= from.getTime() && time < to.getTime();
  }

  private buildZeroFilledPoints(
    buckets: Date[],
    interval: DashboardInterval,
    valuesByBucket: Map<number, number>,
    decimals?: number,
  ): DashboardSeriesPoint[] {
    return buckets.map((bucket) => {
      const raw = valuesByBucket.get(bucket.getTime()) ?? 0;
      const value =
        decimals !== undefined ? this.roundMetric(raw, decimals) : Number(raw);
      return {
        bucket_start: bucket.toISOString(),
        label: formatBucketLabel(bucket, interval),
        value,
      };
    });
  }

  async getOverview(
    user: AuthUser,
    query: DashboardRangeQueryDto,
  ): Promise<DashboardOverviewResponse> {
    const now = new Date();
    const businessId = this.resolveBusinessId(user, query.business_id);
    const range = resolveDashboardRange(
      query.from,
      query.to,
      query.interval ?? DashboardIntervalEnum.DAY,
      now,
    );

    const [business, subscription] = await Promise.all([
      this.getBusinessOrFail(businessId),
      this.subscriptionsService.getCurrentSubscription(businessId),
    ]);

    const hourAgo = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);

    const [
      subscriptionSummary,
      usageLogs,
      orders,
      apiKeys,
      requestsLastHour,
      webhookLogs,
    ] = await Promise.all([
      this.buildSubscriptionSummary(subscription, now),
      this.usageLogsRepository.find({
        where: {
          business_id: businessId,
          created_at: Between(range.from, range.to),
        },
      }),
      this.paymentOrdersRepository.find({
        where: { business_id: businessId },
      }),
      this.apiKeysRepository.find({
        where: { business_id: businessId },
      }),
      this.usageLogsRepository.count({
        where: {
          business_id: businessId,
          action: ApiKeyUsageActionEnum.QR_CREATED,
          created_at: MoreThanOrEqual(hourAgo),
        },
      }),
      this.webhookLogsRepository.find({
        where: {
          process_status: WebhookProcessStatusEnum.MATCHED,
          created_at: Between(range.from, range.to),
        },
        relations: { matched_order: true },
      }),
    ]);

    const logsInRange = usageLogs.filter((log) =>
      this.isInHalfOpenRange(log.created_at, range.from, range.to),
    );

    const qrCreated = logsInRange.filter(
      (log) => log.action === ApiKeyUsageActionEnum.QR_CREATED,
    ).length;
    const qrPaid = logsInRange.filter(
      (log) => log.action === ApiKeyUsageActionEnum.QR_PAID,
    ).length;
    const quotaDeducted = logsInRange.filter(
      (log) =>
        log.action === ApiKeyUsageActionEnum.QR_PAID && log.quota_deducted,
    ).length;
    const usagePaidRate =
      qrCreated > 0 ? this.roundMetric(qrPaid / qrCreated) : 0;

    let ordersCreated = 0;
    let paidCount = 0;
    let expiredCount = 0;
    let activeUnverifiedCount = 0;
    let gmv = 0;

    const orderIdsForBusiness = new Set<string>();

    for (const order of orders) {
      orderIdsForBusiness.add(order.id);
      const createdInRange = this.isInHalfOpenRange(
        order.created_at,
        range.from,
        range.to,
      );
      const paidInRange =
        order.status === PaymentOrderStatusEnum.PAID &&
        this.isInHalfOpenRange(order.paid_at, range.from, range.to);

      if (createdInRange) {
        ordersCreated += 1;
        const isExpired =
          order.status === PaymentOrderStatusEnum.EXPIRED ||
          (order.status === PaymentOrderStatusEnum.UNVERIFIED &&
            new Date(order.expires_at).getTime() <= now.getTime());
        if (isExpired) {
          expiredCount += 1;
        }
      }

      if (paidInRange) {
        paidCount += 1;
        gmv += Number(order.total_amount ?? 0);
      }

      if (
        order.status === PaymentOrderStatusEnum.UNVERIFIED &&
        new Date(order.expires_at).getTime() > now.getTime()
      ) {
        activeUnverifiedCount += 1;
      }
    }

    const roundedGmv = this.roundCurrency(gmv);
    const averageOrderValue =
      paidCount > 0 ? this.roundCurrency(roundedGmv / paidCount) : 0;
    const txDenominator = paidCount + expiredCount;
    const txPaidRate =
      txDenominator > 0 ? this.roundMetric(paidCount / txDenominator) : 0;

    const usedKeysCount = apiKeys.length;
    const activeKeysCount = apiKeys.filter((k) => k.is_active).length;
    const maxApiKeys = subscription ? Number(subscription.max_api_keys) : 0;

    const rateLimit = subscription
      ? Number(subscription.rate_limit_per_hour)
      : 0;
    const rateRemaining = Math.max(0, rateLimit - Number(requestsLastHour));
    const rateUtilization =
      rateLimit > 0
        ? Math.min(
            1,
            Math.max(0, this.roundMetric(Number(requestsLastHour) / rateLimit)),
          )
        : 0;

    const matchedWebhooks = webhookLogs.filter((wh) => {
      if (!this.isInHalfOpenRange(wh.created_at, range.from, range.to)) {
        return false;
      }
      if (wh.matched_order?.business_id) {
        return wh.matched_order.business_id === businessId;
      }
      return Boolean(
        wh.matched_order_id && orderIdsForBusiness.has(wh.matched_order_id),
      );
    }).length;

    return {
      range: toDashboardRangeMeta(range),
      business: {
        id: business.id,
        name: business.business_name,
      },
      subscription: subscriptionSummary,
      usage: {
        qr_created: qrCreated,
        qr_paid: qrPaid,
        quota_deducted: quotaDeducted,
        paid_rate: usagePaidRate,
      },
      transactions: {
        orders_created: ordersCreated,
        paid_count: paidCount,
        expired_count: expiredCount,
        active_unverified_count: activeUnverifiedCount,
        gmv: roundedGmv,
        average_order_value: averageOrderValue,
        paid_rate: txPaidRate,
      },
      api_keys: {
        used: usedKeysCount,
        active: activeKeysCount,
        max: maxApiKeys,
      },
      rate_limit: {
        requests_last_hour: Number(requestsLastHour),
        limit: rateLimit,
        remaining: rateRemaining,
        utilization: rateUtilization,
      },
      webhook: {
        matched: matchedWebhooks,
      },
    };
  }

  async getUsageTimeseries(
    user: AuthUser,
    query: DashboardUsageQueryDto,
  ): Promise<DashboardUsageTimeseriesResponse> {
    const now = new Date();
    const businessId = this.resolveBusinessId(user, query.business_id);
    const range = resolveDashboardRange(
      query.from,
      query.to,
      query.interval ?? DashboardIntervalEnum.DAY,
      now,
    );

    await this.getBusinessOrFail(businessId);

    const where: Record<string, unknown> = {
      business_id: businessId,
      created_at: Between(range.from, range.to),
    };
    if (query.api_key_id) {
      where.api_key_id = query.api_key_id;
    }

    const logs = await this.usageLogsRepository.find({ where });
    const buckets = generateBuckets(range.from, range.to, range.interval);

    const createdMap = new Map<number, number>();
    const paidMap = new Map<number, number>();
    const deductedMap = new Map<number, number>();

    for (const log of logs) {
      if (!this.isInHalfOpenRange(log.created_at, range.from, range.to)) {
        continue;
      }

      const bucketKey = startOfBangkokBucket(
        new Date(log.created_at),
        range.interval,
      ).getTime();

      if (log.action === ApiKeyUsageActionEnum.QR_CREATED) {
        createdMap.set(bucketKey, (createdMap.get(bucketKey) ?? 0) + 1);
      } else if (log.action === ApiKeyUsageActionEnum.QR_PAID) {
        paidMap.set(bucketKey, (paidMap.get(bucketKey) ?? 0) + 1);
        if (log.quota_deducted) {
          deductedMap.set(bucketKey, (deductedMap.get(bucketKey) ?? 0) + 1);
        }
      }
    }

    const allSeries: Record<DashboardUsageMetric, DashboardSeries> = {
      [DashboardUsageMetricEnum.QR_CREATED]: {
        key: DashboardUsageMetricEnum.QR_CREATED,
        label: 'QR Created',
        points: this.buildZeroFilledPoints(buckets, range.interval, createdMap),
      },
      [DashboardUsageMetricEnum.QR_PAID]: {
        key: DashboardUsageMetricEnum.QR_PAID,
        label: 'QR Paid',
        points: this.buildZeroFilledPoints(buckets, range.interval, paidMap),
      },
      [DashboardUsageMetricEnum.QUOTA_DEDUCTED]: {
        key: DashboardUsageMetricEnum.QUOTA_DEDUCTED,
        label: 'Quota Deducted',
        points: this.buildZeroFilledPoints(
          buckets,
          range.interval,
          deductedMap,
        ),
      },
    };

    const series = query.metric
      ? [allSeries[query.metric]]
      : [
          allSeries[DashboardUsageMetricEnum.QR_CREATED],
          allSeries[DashboardUsageMetricEnum.QR_PAID],
          allSeries[DashboardUsageMetricEnum.QUOTA_DEDUCTED],
        ];

    return {
      range: toDashboardRangeMeta(range),
      series,
    };
  }

  async getTransactionsTimeseries(
    user: AuthUser,
    query: DashboardRangeQueryDto,
  ): Promise<DashboardTransactionsTimeseriesResponse> {
    const now = new Date();
    const businessId = this.resolveBusinessId(user, query.business_id);
    const range = resolveDashboardRange(
      query.from,
      query.to,
      query.interval ?? DashboardIntervalEnum.DAY,
      now,
    );

    await this.getBusinessOrFail(businessId);

    const orders = await this.paymentOrdersRepository.find({
      where: { business_id: businessId },
    });

    const buckets = generateBuckets(range.from, range.to, range.interval);
    const ordersCreatedMap = new Map<number, number>();
    const paidCountMap = new Map<number, number>();
    const expiredCountMap = new Map<number, number>();
    const gmvMap = new Map<number, number>();

    let statusPaid = 0;
    let statusUnverifiedActive = 0;
    let statusUnverifiedExpired = 0;
    let statusExpired = 0;

    for (const order of orders) {
      const createdInRange = this.isInHalfOpenRange(
        order.created_at,
        range.from,
        range.to,
      );
      const paidInRange =
        order.status === PaymentOrderStatusEnum.PAID &&
        this.isInHalfOpenRange(order.paid_at, range.from, range.to);

      if (createdInRange) {
        const createdBucket = startOfBangkokBucket(
          new Date(order.created_at),
          range.interval,
        ).getTime();
        ordersCreatedMap.set(
          createdBucket,
          (ordersCreatedMap.get(createdBucket) ?? 0) + 1,
        );

        if (order.status === PaymentOrderStatusEnum.EXPIRED) {
          statusExpired += 1;
          expiredCountMap.set(
            createdBucket,
            (expiredCountMap.get(createdBucket) ?? 0) + 1,
          );
        } else if (order.status === PaymentOrderStatusEnum.UNVERIFIED) {
          if (new Date(order.expires_at).getTime() <= now.getTime()) {
            statusUnverifiedExpired += 1;
            expiredCountMap.set(
              createdBucket,
              (expiredCountMap.get(createdBucket) ?? 0) + 1,
            );
          } else {
            statusUnverifiedActive += 1;
          }
        }
      }

      if (paidInRange && order.paid_at) {
        statusPaid += 1;
        const paidBucket = startOfBangkokBucket(
          new Date(order.paid_at),
          range.interval,
        ).getTime();
        paidCountMap.set(paidBucket, (paidCountMap.get(paidBucket) ?? 0) + 1);
        gmvMap.set(
          paidBucket,
          (gmvMap.get(paidBucket) ?? 0) + Number(order.total_amount ?? 0),
        );
      }
    }

    const aovMap = new Map<number, number>();
    for (const bucket of buckets) {
      const key = bucket.getTime();
      const paid = paidCountMap.get(key) ?? 0;
      const gmv = gmvMap.get(key) ?? 0;
      aovMap.set(key, paid > 0 ? gmv / paid : 0);
    }

    return {
      range: toDashboardRangeMeta(range),
      series: [
        {
          key: 'orders_created',
          label: 'Orders Created',
          points: this.buildZeroFilledPoints(
            buckets,
            range.interval,
            ordersCreatedMap,
          ),
        },
        {
          key: 'paid_count',
          label: 'Paid Orders',
          points: this.buildZeroFilledPoints(
            buckets,
            range.interval,
            paidCountMap,
          ),
        },
        {
          key: 'expired_count',
          label: 'Expired Orders',
          points: this.buildZeroFilledPoints(
            buckets,
            range.interval,
            expiredCountMap,
          ),
        },
        {
          key: 'gmv',
          label: 'GMV',
          points: this.buildZeroFilledPoints(
            buckets,
            range.interval,
            gmvMap,
            2,
          ),
        },
        {
          key: 'average_order_value',
          label: 'Average Order Value',
          points: this.buildZeroFilledPoints(
            buckets,
            range.interval,
            aovMap,
            2,
          ),
        },
      ],
      status_breakdown: {
        PAID: statusPaid,
        UNVERIFIED: {
          active: statusUnverifiedActive,
          expired: statusUnverifiedExpired,
        },
        EXPIRED: statusExpired,
      },
    };
  }

  async getRateLimitStatus(
    user: AuthUser,
    query: DashboardRangeQueryDto,
  ): Promise<DashboardRateLimitResponse> {
    const now = new Date();
    const businessId = this.resolveBusinessId(user, query.business_id);
    const hours = Math.min(168, Math.max(1, Number(query.hours ?? 24)));

    await this.getBusinessOrFail(businessId);
    const subscription =
      await this.subscriptionsService.getCurrentSubscription(businessId);

    const hourAgo = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);
    const seriesEnd = startOfBangkokBucket(
      new Date(now.getTime() + RATE_LIMIT_WINDOW_MS),
      DashboardIntervalEnum.HOUR,
    );
    const seriesStart = new Date(
      seriesEnd.getTime() - hours * RATE_LIMIT_WINDOW_MS,
    );

    const [requestsLastHour, logs] = await Promise.all([
      this.usageLogsRepository.count({
        where: {
          business_id: businessId,
          action: ApiKeyUsageActionEnum.QR_CREATED,
          created_at: MoreThanOrEqual(hourAgo),
        },
      }),
      this.usageLogsRepository.find({
        where: {
          business_id: businessId,
          action: ApiKeyUsageActionEnum.QR_CREATED,
          created_at: Between(seriesStart, seriesEnd),
        },
      }),
    ]);

    const buckets = generateBuckets(
      seriesStart,
      seriesEnd,
      DashboardIntervalEnum.HOUR,
    );
    const bucketCounts = new Map<number, number>();

    for (const log of logs) {
      if (!this.isInHalfOpenRange(log.created_at, seriesStart, seriesEnd)) {
        continue;
      }
      const key = startOfBangkokBucket(
        new Date(log.created_at),
        DashboardIntervalEnum.HOUR,
      ).getTime();
      bucketCounts.set(key, (bucketCounts.get(key) ?? 0) + 1);
    }

    const limitPerHour = subscription
      ? Number(subscription.rate_limit_per_hour)
      : 0;
    const remaining = Math.max(0, limitPerHour - Number(requestsLastHour));
    const utilization =
      limitPerHour > 0
        ? Math.min(
            1,
            Math.max(
              0,
              this.roundMetric(Number(requestsLastHour) / limitPerHour),
            ),
          )
        : 0;

    return {
      business_id: businessId,
      requests_last_hour: Number(requestsLastHour),
      limit_per_hour: limitPerHour,
      remaining,
      utilization,
      series: this.buildZeroFilledPoints(
        buckets,
        DashboardIntervalEnum.HOUR,
        bucketCounts,
      ),
    };
  }

  async getApiKeyBreakdown(
    user: AuthUser,
    query: DashboardApiKeysQueryDto,
  ): Promise<DashboardApiKeyBreakdownResponse> {
    const now = new Date();
    const businessId = this.resolveBusinessId(user, query.business_id);
    const range = resolveDashboardRange(
      query.from,
      query.to,
      query.interval ?? DashboardIntervalEnum.DAY,
      now,
    );
    const includeDeleted = query.include_deleted ?? true;

    await this.getBusinessOrFail(businessId);

    const [subscription, keys, logs] = await Promise.all([
      this.subscriptionsService.getCurrentSubscription(businessId),
      this.apiKeysRepository.find({
        where: { business_id: businessId },
        order: { created_at: 'DESC' },
        withDeleted: includeDeleted,
      }),
      this.usageLogsRepository.find({
        where: {
          business_id: businessId,
          created_at: Between(range.from, range.to),
        },
      }),
    ]);

    const countsByKey = new Map<
      string,
      { qr_created: number; qr_paid: number; quota_deducted: number }
    >();

    for (const log of logs) {
      if (!this.isInHalfOpenRange(log.created_at, range.from, range.to)) {
        continue;
      }

      const entry = countsByKey.get(log.api_key_id) ?? {
        qr_created: 0,
        qr_paid: 0,
        quota_deducted: 0,
      };

      if (log.action === ApiKeyUsageActionEnum.QR_CREATED) {
        entry.qr_created += 1;
      } else if (log.action === ApiKeyUsageActionEnum.QR_PAID) {
        entry.qr_paid += 1;
        if (log.quota_deducted) {
          entry.quota_deducted += 1;
        }
      }

      countsByKey.set(log.api_key_id, entry);
    }

    let totalCreated = 0;
    let totalPaid = 0;

    for (const key of keys) {
      const c = countsByKey.get(key.id);
      if (c) {
        totalCreated += c.qr_created;
        totalPaid += c.qr_paid;
      }
    }

    const items: DashboardApiKeyBreakdownItem[] = keys.map((key) => {
      const stats = countsByKey.get(key.id) ?? {
        qr_created: 0,
        qr_paid: 0,
        quota_deducted: 0,
      };

      return {
        id: key.id,
        name: key.name,
        key_prefix: key.key_prefix,
        is_active: Boolean(key.is_active && !key.deleted_at),
        deleted_at: key.deleted_at ? new Date(key.deleted_at).toISOString() : null,
        created_at: new Date(key.created_at).toISOString(),
        last_used_at: key.last_used_at
          ? new Date(key.last_used_at).toISOString()
          : null,
        qr_created: stats.qr_created,
        qr_paid: stats.qr_paid,
        quota_deducted: stats.quota_deducted,
        share_of_created:
          totalCreated > 0
            ? this.roundMetric(stats.qr_created / totalCreated)
            : 0,
        share_of_paid:
          totalPaid > 0 ? this.roundMetric(stats.qr_paid / totalPaid) : 0,
      };
    });

    const activeKeys = keys.filter((k) => k.is_active && !k.deleted_at).length;
    const revokedKeys = keys.filter((k) => !k.is_active || k.deleted_at).length;

    return {
      range: toDashboardRangeMeta(range),
      summary: {
        total_keys: keys.length,
        active_keys: activeKeys,
        revoked_keys: revokedKeys,
        max_api_keys: subscription ? Number(subscription.max_api_keys) : 0,
      },
      keys: items,
    };
  }

  async getApiKeyTimeseries(
    user: AuthUser,
    query: DashboardApiKeysQueryDto,
  ): Promise<DashboardApiKeyTimeseriesResponse> {
    const now = new Date();
    const businessId = this.resolveBusinessId(user, query.business_id);
    const range = resolveDashboardRange(
      query.from,
      query.to,
      query.interval ?? DashboardIntervalEnum.DAY,
      now,
    );
    const metric: DashboardUsageMetric =
      query.metric ?? DashboardUsageMetricEnum.QR_CREATED;
    const includeDeleted = query.include_deleted ?? true;

    await this.getBusinessOrFail(businessId);

    const whereLogs: Record<string, unknown> = {
      business_id: businessId,
      created_at: Between(range.from, range.to),
    };
    if (query.api_key_id) {
      whereLogs.api_key_id = query.api_key_id;
    }

    const [keys, logs] = await Promise.all([
      this.apiKeysRepository.find({
        where: query.api_key_id
          ? { id: query.api_key_id, business_id: businessId }
          : { business_id: businessId },
        order: { created_at: 'DESC' },
        withDeleted: includeDeleted,
      }),
      this.usageLogsRepository.find({ where: whereLogs }),
    ]);

    const buckets = generateBuckets(range.from, range.to, range.interval);
    const keyMap = new Map<string, ApiKey>();
    for (const key of keys) {
      keyMap.set(key.id, key);
    }

    const perKeyBucket = new Map<string, Map<number, number>>();
    const perKeyTotal = new Map<string, number>();

    for (const key of keys) {
      perKeyBucket.set(key.id, new Map<number, number>());
      perKeyTotal.set(key.id, 0);
    }

    for (const log of logs) {
      if (!this.isInHalfOpenRange(log.created_at, range.from, range.to)) {
        continue;
      }

      if (!keyMap.has(log.api_key_id)) {
        continue;
      }

      const matchesMetric =
        (metric === DashboardUsageMetricEnum.QR_CREATED &&
          log.action === ApiKeyUsageActionEnum.QR_CREATED) ||
        (metric === DashboardUsageMetricEnum.QR_PAID &&
          log.action === ApiKeyUsageActionEnum.QR_PAID) ||
        (metric === DashboardUsageMetricEnum.QUOTA_DEDUCTED &&
          log.action === ApiKeyUsageActionEnum.QR_PAID &&
          log.quota_deducted);

      if (!matchesMetric) {
        continue;
      }

      const bucketKey = startOfBangkokBucket(
        new Date(log.created_at),
        range.interval,
      ).getTime();

      const bucketMap =
        perKeyBucket.get(log.api_key_id) ?? new Map<number, number>();
      bucketMap.set(bucketKey, (bucketMap.get(bucketKey) ?? 0) + 1);
      perKeyBucket.set(log.api_key_id, bucketMap);

      perKeyTotal.set(
        log.api_key_id,
        (perKeyTotal.get(log.api_key_id) ?? 0) + 1,
      );
    }

    const sortedKeys = [...keys].sort(
      (a, b) => (perKeyTotal.get(b.id) ?? 0) - (perKeyTotal.get(a.id) ?? 0),
    );

    const topKeys = sortedKeys.slice(0, MAX_TOP_KEYS);
    const overflowKeys = sortedKeys.slice(MAX_TOP_KEYS);

    const series: DashboardSeries[] = topKeys.map((key) => {
      const label = key.deleted_at
        ? `Deleted: ${key.name}`
        : `${key.name} (${key.key_prefix})`;
      return {
        key: `api_key:${key.id}`,
        label,
        points: this.buildZeroFilledPoints(
          buckets,
          range.interval,
          perKeyBucket.get(key.id) ?? new Map<number, number>(),
        ),
      };
    });

    if (overflowKeys.length > 0) {
      const otherBuckets = new Map<number, number>();
      for (const key of overflowKeys) {
        const map = perKeyBucket.get(key.id);
        if (!map) {
          continue;
        }
        for (const [bucketTime, val] of map.entries()) {
          otherBuckets.set(
            bucketTime,
            (otherBuckets.get(bucketTime) ?? 0) + val,
          );
        }
      }

      series.push({
        key: 'other',
        label: 'Other Keys',
        points: this.buildZeroFilledPoints(
          buckets,
          range.interval,
          otherBuckets,
        ),
      });
    }

    return {
      range: toDashboardRangeMeta(range),
      series,
    };
  }

  async getSubscriptionTrend(
    user: AuthUser,
    query: DashboardRangeQueryDto,
  ): Promise<DashboardSubscriptionTrendResponse> {
    const now = new Date();
    const businessId = this.resolveBusinessId(user, query.business_id);

    await this.getBusinessOrFail(businessId);

    const [subscription, periods] = await Promise.all([
      this.subscriptionsService.getCurrentSubscription(businessId),
      this.periodsRepository.find({
        where: { business_id: businessId },
        order: { created_at: 'DESC' },
      }),
    ]);

    const periodItems: DashboardSubscriptionPeriodItem[] = periods.map((p) => {
      const limit = Number(p.quota_limit);
      const used = Number(p.quota_used);
      return {
        id: p.id,
        subscription_id: p.subscription_id,
        business_id: p.business_id,
        package_id: p.package_id,
        period_start: new Date(p.period_start).toISOString(),
        period_end: new Date(p.period_end).toISOString(),
        quota_limit: limit,
        quota_used: used,
        utilization: limit > 0 ? this.roundMetric(used / limit) : 0,
        created_at: new Date(p.created_at).toISOString(),
      };
    });

    if (!subscription) {
      return {
        current: null,
        quota: { daily: [] },
        periods: periodItems,
      };
    }

    const currentSummary = await this.buildSubscriptionSummary(
      subscription,
      now,
    );
    const periodStart = new Date(subscription.current_period_start);
    const periodEnd = new Date(subscription.current_period_end);
    const effectiveEnd = new Date(
      Math.min(now.getTime(), periodEnd.getTime()),
    );

    const logs =
      periodStart.getTime() < effectiveEnd.getTime()
        ? await this.usageLogsRepository.find({
            where: {
              business_id: businessId,
              action: ApiKeyUsageActionEnum.QR_PAID,
              quota_deducted: true,
              created_at: Between(periodStart, effectiveEnd),
            },
          })
        : [];

    const buckets = generateBuckets(
      periodStart,
      effectiveEnd,
      DashboardIntervalEnum.DAY,
    );
    const dailyDeducted = new Map<number, number>();

    for (const log of logs) {
      if (
        !this.isInHalfOpenRange(log.created_at, periodStart, effectiveEnd) ||
        log.action !== ApiKeyUsageActionEnum.QR_PAID ||
        !log.quota_deducted
      ) {
        continue;
      }

      const key = startOfBangkokBucket(
        new Date(log.created_at),
        DashboardIntervalEnum.DAY,
      ).getTime();
      dailyDeducted.set(key, (dailyDeducted.get(key) ?? 0) + 1);
    }

    const quotaLimit = Number(subscription.quota_limit);
    let cumulativeUsed = 0;

    const dailyPoints: DashboardQuotaDailyPoint[] = buckets.map((bucket) => {
      const deducted = dailyDeducted.get(bucket.getTime()) ?? 0;
      cumulativeUsed += deducted;
      const remaining = Math.max(0, quotaLimit - cumulativeUsed);

      return {
        bucket_start: bucket.toISOString(),
        label: formatBucketLabel(bucket, DashboardIntervalEnum.DAY),
        quota_deducted: deducted,
        cumulative_used: cumulativeUsed,
        quota_remaining: remaining,
      };
    });

    return {
      current: currentSummary,
      quota: {
        daily: dailyPoints,
      },
      periods: periodItems,
    };
  }

  async getAdminOverview(
    query: DashboardRangeQueryDto,
  ): Promise<AdminOverviewResponse> {
    const now = new Date();
    const range = resolveDashboardRange(
      query.from,
      query.to,
      query.interval ?? DashboardIntervalEnum.DAY,
      now,
    );

    const [businesses, subscriptions, packages, orders, usageLogs, webhookLogs] =
      await Promise.all([
        this.businessesRepository.find(),
        this.subscriptionsRepository.find(),
        this.packagesRepository.find({ withDeleted: true }),
        this.paymentOrdersRepository.find(),
        this.usageLogsRepository.find({
          where: {
            created_at: Between(range.from, range.to),
          },
        }),
        this.webhookLogsRepository.find({
          where: {
            created_at: Between(range.from, range.to),
          },
        }),
      ]);

    const packagePriceMap = new Map<string, number>();
    for (const pkg of packages) {
      packagePriceMap.set(pkg.id, Number(pkg.price ?? 0));
    }

    const totalBusinesses = businesses.length;
    const activeBusinesses = businesses.filter((b) => b.is_active).length;
    const newBusinessesInRange = businesses.filter((b) =>
      this.isInHalfOpenRange(b.created_at, range.from, range.to),
    ).length;

    let activeSubs = 0;
    let pastDueSubs = 0;
    let cancelledSubs = 0;
    let expiring7d = 0;
    let expiring30d = 0;
    let estimatedMrr = 0;

    const sevenDaysLater = now.getTime() + 7 * DAY_MS;
    const thirtyDaysLater = now.getTime() + 30 * DAY_MS;

    for (const sub of subscriptions) {
      if (sub.deleted_at) {
        continue;
      }

      if (sub.status === BusinessSubscriptionStatusEnum.ACTIVE) {
        activeSubs += 1;
        estimatedMrr += packagePriceMap.get(sub.package_id) ?? 0;

        const endMs = new Date(sub.current_period_end).getTime();
        if (endMs >= now.getTime() && endMs <= sevenDaysLater) {
          expiring7d += 1;
        }
        if (endMs >= now.getTime() && endMs <= thirtyDaysLater) {
          expiring30d += 1;
        }
      } else if (sub.status === BusinessSubscriptionStatusEnum.PAST_DUE) {
        pastDueSubs += 1;
      } else if (sub.status === BusinessSubscriptionStatusEnum.CANCELLED) {
        cancelledSubs += 1;
      }
    }

    let ordersCreated = 0;
    let paidCount = 0;
    let expiredCount = 0;
    let activeUnverifiedCount = 0;
    let gmv = 0;

    for (const order of orders) {
      const createdInRange = this.isInHalfOpenRange(
        order.created_at,
        range.from,
        range.to,
      );
      const paidInRange =
        order.status === PaymentOrderStatusEnum.PAID &&
        this.isInHalfOpenRange(order.paid_at, range.from, range.to);

      if (createdInRange) {
        ordersCreated += 1;
        const isExpired =
          order.status === PaymentOrderStatusEnum.EXPIRED ||
          (order.status === PaymentOrderStatusEnum.UNVERIFIED &&
            new Date(order.expires_at).getTime() <= now.getTime());
        if (isExpired) {
          expiredCount += 1;
        }
      }

      if (paidInRange) {
        paidCount += 1;
        gmv += Number(order.total_amount ?? 0);
      }

      if (
        order.status === PaymentOrderStatusEnum.UNVERIFIED &&
        new Date(order.expires_at).getTime() > now.getTime()
      ) {
        activeUnverifiedCount += 1;
      }
    }

    const logsInRange = usageLogs.filter((log) =>
      this.isInHalfOpenRange(log.created_at, range.from, range.to),
    );
    const qrCreated = logsInRange.filter(
      (log) => log.action === ApiKeyUsageActionEnum.QR_CREATED,
    ).length;
    const qrPaid = logsInRange.filter(
      (log) => log.action === ApiKeyUsageActionEnum.QR_PAID,
    ).length;

    const roundedGmv = this.roundCurrency(gmv);
    const averageOrderValue =
      paidCount > 0 ? this.roundCurrency(roundedGmv / paidCount) : 0;
    const txDenominator = paidCount + expiredCount;
    const paidRate =
      txDenominator > 0 ? this.roundMetric(paidCount / txDenominator) : 0;

    const webhooksInRange = webhookLogs.filter((wh) =>
      this.isInHalfOpenRange(wh.created_at, range.from, range.to),
    );
    const matchedWebhooks = webhooksInRange.filter(
      (wh) => wh.process_status === WebhookProcessStatusEnum.MATCHED,
    ).length;
    const noMatchWebhooks = webhooksInRange.filter(
      (wh) => wh.process_status === WebhookProcessStatusEnum.NO_MATCH,
    ).length;
    const webhookDenominator = matchedWebhooks + noMatchWebhooks;
    const matchRate =
      webhookDenominator > 0
        ? this.roundMetric(matchedWebhooks / webhookDenominator)
        : 0;

    const roundedMrr = this.roundCurrency(estimatedMrr);
    const roundedArr = this.roundCurrency(roundedMrr * 12);

    return {
      range: toDashboardRangeMeta(range),
      businesses: {
        total: totalBusinesses,
        active: activeBusinesses,
        new_in_range: newBusinessesInRange,
      },
      subscriptions: {
        active: activeSubs,
        past_due: pastDueSubs,
        cancelled: cancelledSubs,
        expiring_7d: expiring7d,
        expiring_30d: expiring30d,
      },
      platform: {
        orders_created: ordersCreated,
        paid_count: paidCount,
        expired_count: expiredCount,
        active_unverified_count: activeUnverifiedCount,
        gmv: roundedGmv,
        average_order_value: averageOrderValue,
        paid_rate: paidRate,
        qr_created: qrCreated,
        qr_paid: qrPaid,
      },
      webhook: {
        matched: matchedWebhooks,
        no_match: noMatchWebhooks,
        match_rate: matchRate,
      },
      estimated_mrr: roundedMrr,
      estimated_arr: roundedArr,
    };
  }

  async getAdminTimeseries(
    query: DashboardRangeQueryDto,
  ): Promise<AdminTimeseriesResponse> {
    const now = new Date();
    const range = resolveDashboardRange(
      query.from,
      query.to,
      query.interval ?? DashboardIntervalEnum.DAY,
      now,
    );

    const [businesses, orders, usageLogs] = await Promise.all([
      this.businessesRepository.find({
        where: {
          created_at: Between(range.from, range.to),
        },
      }),
      this.paymentOrdersRepository.find(),
      this.usageLogsRepository.find({
        where: {
          created_at: Between(range.from, range.to),
        },
      }),
    ]);

    const buckets = generateBuckets(range.from, range.to, range.interval);
    const newBusinessesMap = new Map<number, number>();
    const ordersCreatedMap = new Map<number, number>();
    const paidCountMap = new Map<number, number>();
    const gmvMap = new Map<number, number>();
    const qrCreatedMap = new Map<number, number>();
    const qrPaidMap = new Map<number, number>();

    for (const business of businesses) {
      if (!this.isInHalfOpenRange(business.created_at, range.from, range.to)) {
        continue;
      }
      const key = startOfBangkokBucket(
        new Date(business.created_at),
        range.interval,
      ).getTime();
      newBusinessesMap.set(key, (newBusinessesMap.get(key) ?? 0) + 1);
    }

    for (const order of orders) {
      if (this.isInHalfOpenRange(order.created_at, range.from, range.to)) {
        const key = startOfBangkokBucket(
          new Date(order.created_at),
          range.interval,
        ).getTime();
        ordersCreatedMap.set(key, (ordersCreatedMap.get(key) ?? 0) + 1);
      }

      if (
        order.status === PaymentOrderStatusEnum.PAID &&
        order.paid_at &&
        this.isInHalfOpenRange(order.paid_at, range.from, range.to)
      ) {
        const key = startOfBangkokBucket(
          new Date(order.paid_at),
          range.interval,
        ).getTime();
        paidCountMap.set(key, (paidCountMap.get(key) ?? 0) + 1);
        gmvMap.set(
          key,
          (gmvMap.get(key) ?? 0) + Number(order.total_amount ?? 0),
        );
      }
    }

    for (const log of usageLogs) {
      if (!this.isInHalfOpenRange(log.created_at, range.from, range.to)) {
        continue;
      }
      const key = startOfBangkokBucket(
        new Date(log.created_at),
        range.interval,
      ).getTime();

      if (log.action === ApiKeyUsageActionEnum.QR_CREATED) {
        qrCreatedMap.set(key, (qrCreatedMap.get(key) ?? 0) + 1);
      } else if (log.action === ApiKeyUsageActionEnum.QR_PAID) {
        qrPaidMap.set(key, (qrPaidMap.get(key) ?? 0) + 1);
      }
    }

    return {
      range: toDashboardRangeMeta(range),
      series: [
        {
          key: 'new_businesses',
          label: 'New Businesses',
          points: this.buildZeroFilledPoints(
            buckets,
            range.interval,
            newBusinessesMap,
          ),
        },
        {
          key: 'orders_created',
          label: 'Orders Created',
          points: this.buildZeroFilledPoints(
            buckets,
            range.interval,
            ordersCreatedMap,
          ),
        },
        {
          key: 'paid_count',
          label: 'Paid Orders',
          points: this.buildZeroFilledPoints(
            buckets,
            range.interval,
            paidCountMap,
          ),
        },
        {
          key: 'gmv',
          label: 'GMV',
          points: this.buildZeroFilledPoints(
            buckets,
            range.interval,
            gmvMap,
            2,
          ),
        },
        {
          key: 'qr_created',
          label: 'QR Created',
          points: this.buildZeroFilledPoints(
            buckets,
            range.interval,
            qrCreatedMap,
          ),
        },
        {
          key: 'qr_paid',
          label: 'QR Paid',
          points: this.buildZeroFilledPoints(
            buckets,
            range.interval,
            qrPaidMap,
          ),
        },
      ],
    };
  }

  async getAdminDistribution(
    _query: DashboardRangeQueryDto,
  ): Promise<AdminDistributionResponse> {
    const [packages, subscriptions] = await Promise.all([
      this.packagesRepository.find({ order: { price: 'ASC' } }),
      this.subscriptionsRepository.find(),
    ]);

    const nonDeletedSubs = subscriptions.filter((sub) => !sub.deleted_at);

    const packageDistribution: AdminPackageDistributionItem[] = packages.map(
      (pkg) => {
        const subsForPkg = nonDeletedSubs.filter(
          (s) => s.package_id === pkg.id,
        );
        const activeCount = subsForPkg.filter(
          (s) => s.status === BusinessSubscriptionStatusEnum.ACTIVE,
        ).length;
        const pastDueCount = subsForPkg.filter(
          (s) => s.status === BusinessSubscriptionStatusEnum.PAST_DUE,
        ).length;

        return {
          package_id: pkg.id,
          code: pkg.code,
          name: pkg.name,
          price: Number(pkg.price ?? 0),
          business_count: subsForPkg.length,
          active_count: activeCount,
          past_due_count: pastDueCount,
        };
      },
    );

    const statuses: BusinessSubscriptionStatus[] = Object.values(
      BusinessSubscriptionStatusEnum,
    );
    const subscriptionStatus: AdminStatusDistributionItem[] = statuses.map(
      (status) => ({
        status,
        count: nonDeletedSubs.filter((s) => s.status === status).length,
      }),
    );

    const bucketCounts: Record<QuotaUtilizationBucket, number> = {
      '0-25': 0,
      '26-50': 0,
      '51-75': 0,
      '76-100': 0,
      '100+': 0,
    };

    for (const sub of nonDeletedSubs) {
      if (
        sub.status !== BusinessSubscriptionStatusEnum.ACTIVE &&
        sub.status !== BusinessSubscriptionStatusEnum.PAST_DUE
      ) {
        continue;
      }

      const limit = Number(sub.quota_limit);
      const used = Number(sub.quota_used);
      const pct = limit > 0 ? (used / limit) * 100 : 0;

      if (pct > 100) {
        bucketCounts['100+'] += 1;
      } else if (pct > 75) {
        bucketCounts['76-100'] += 1;
      } else if (pct > 50) {
        bucketCounts['51-75'] += 1;
      } else if (pct > 25) {
        bucketCounts['26-50'] += 1;
      } else {
        bucketCounts['0-25'] += 1;
      }
    }

    const quotaUtilization: AdminQuotaUtilizationItem[] = (
      ['0-25', '26-50', '51-75', '76-100', '100+'] as QuotaUtilizationBucket[]
    ).map((bucket) => ({
      bucket,
      count: bucketCounts[bucket],
    }));

    return {
      packages: packageDistribution,
      subscription_status: subscriptionStatus,
      quota_utilization: quotaUtilization,
    };
  }

  async getAdminBusinesses(
    query: AdminBusinessesQueryDto,
  ): Promise<AdminBusinessesResponse> {
    const now = new Date();
    const range = resolveDashboardRange(
      query.from,
      query.to,
      query.interval ?? DashboardIntervalEnum.DAY,
      now,
    );

    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20)));
    const sortBy = query.sort_by ?? AdminBusinessesSortByEnum.CREATED_AT;
    const sortOrder = query.sort_order ?? SortOrderEnum.DESC;
    const search = query.search?.trim().toLowerCase();

    const [businesses, subscriptions, packages, apiKeys, usageLogs, orders] =
      await Promise.all([
        this.businessesRepository.find({ order: { created_at: 'DESC' } }),
        this.subscriptionsRepository.find({ order: { created_at: 'DESC' } }),
        this.packagesRepository.find({ withDeleted: true }),
        this.apiKeysRepository.find(),
        this.usageLogsRepository.find({
          where: {
            created_at: Between(range.from, range.to),
          },
        }),
        this.paymentOrdersRepository.find(),
      ]);

    const packageMap = new Map<string, Package>();
    for (const pkg of packages) {
      packageMap.set(pkg.id, pkg);
    }

    const latestSubByBusiness = new Map<string, BusinessSubscription>();
    for (const sub of subscriptions) {
      if (sub.deleted_at) {
        continue;
      }
      if (!latestSubByBusiness.has(sub.business_id)) {
        latestSubByBusiness.set(sub.business_id, sub);
      }
    }

    const keysUsedByBusiness = new Map<string, number>();
    for (const key of apiKeys) {
      if (key.deleted_at) {
        continue;
      }
      keysUsedByBusiness.set(
        key.business_id,
        (keysUsedByBusiness.get(key.business_id) ?? 0) + 1,
      );
    }

    const qrCreatedByBusiness = new Map<string, number>();
    const qrPaidByBusiness = new Map<string, number>();
    for (const log of usageLogs) {
      if (!this.isInHalfOpenRange(log.created_at, range.from, range.to)) {
        continue;
      }
      if (log.action === ApiKeyUsageActionEnum.QR_CREATED) {
        qrCreatedByBusiness.set(
          log.business_id,
          (qrCreatedByBusiness.get(log.business_id) ?? 0) + 1,
        );
      } else if (log.action === ApiKeyUsageActionEnum.QR_PAID) {
        qrPaidByBusiness.set(
          log.business_id,
          (qrPaidByBusiness.get(log.business_id) ?? 0) + 1,
        );
      }
    }

    const gmvByBusiness = new Map<string, number>();
    for (const order of orders) {
      if (
        order.status === PaymentOrderStatusEnum.PAID &&
        this.isInHalfOpenRange(order.paid_at, range.from, range.to)
      ) {
        gmvByBusiness.set(
          order.business_id,
          (gmvByBusiness.get(order.business_id) ?? 0) +
            Number(order.total_amount ?? 0),
        );
      }
    }

    const enriched = businesses
      .filter((business) => {
        if (
          search &&
          !business.business_name.toLowerCase().includes(search)
        ) {
          return false;
        }

        const sub = latestSubByBusiness.get(business.id) ?? null;

        if (query.package_id && sub?.package_id !== query.package_id) {
          return false;
        }

        if (query.status && sub?.status !== query.status) {
          return false;
        }

        return true;
      })
      .map((business) => {
        const sub = latestSubByBusiness.get(business.id) ?? null;
        const pkg = sub ? (packageMap.get(sub.package_id) ?? null) : null;
        const gmv = this.roundCurrency(gmvByBusiness.get(business.id) ?? 0);

        const item: AdminBusinessListItem = {
          business_id: business.id,
          business_name: business.business_name,
          package_code: pkg?.code ?? null,
          package_name: pkg?.name ?? null,
          subscription_status: sub?.status ?? null,
          quota_limit: sub ? Number(sub.quota_limit) : null,
          quota_used: sub ? Number(sub.quota_used) : null,
          quota_remaining: sub ? Number(sub.quota_remaining) : null,
          current_period_end: sub?.current_period_end
            ? new Date(sub.current_period_end).toISOString()
            : null,
          last_payment_at: sub?.last_payment_at
            ? new Date(sub.last_payment_at).toISOString()
            : null,
          api_keys_used: keysUsedByBusiness.get(business.id) ?? 0,
          api_keys_max: sub ? Number(sub.max_api_keys) : null,
          qr_created: qrCreatedByBusiness.get(business.id) ?? 0,
          qr_paid: qrPaidByBusiness.get(business.id) ?? 0,
          gmv,
        };

        return {
          item,
          createdAtMs: new Date(business.created_at).getTime(),
          periodEndMs: sub?.current_period_end
            ? new Date(sub.current_period_end).getTime()
            : -Infinity,
        };
      });

    const direction = sortOrder === SortOrderEnum.ASC ? 1 : -1;
    enriched.sort((a, b) => {
      let valA = 0;
      let valB = 0;

      switch (sortBy) {
        case AdminBusinessesSortByEnum.GMV:
          valA = a.item.gmv;
          valB = b.item.gmv;
          break;
        case AdminBusinessesSortByEnum.QR_CREATED:
          valA = a.item.qr_created;
          valB = b.item.qr_created;
          break;
        case AdminBusinessesSortByEnum.QR_PAID:
          valA = a.item.qr_paid;
          valB = b.item.qr_paid;
          break;
        case AdminBusinessesSortByEnum.QUOTA_USED:
          valA = a.item.quota_used ?? -1;
          valB = b.item.quota_used ?? -1;
          break;
        case AdminBusinessesSortByEnum.CURRENT_PERIOD_END:
          valA = a.periodEndMs;
          valB = b.periodEndMs;
          break;
        case AdminBusinessesSortByEnum.CREATED_AT:
        default:
          valA = a.createdAtMs;
          valB = b.createdAtMs;
          break;
      }

      if (valA === valB) {
        return a.item.business_name.localeCompare(b.item.business_name);
      }

      return (valA - valB) * direction;
    });

    const total = enriched.length;
    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
    const offset = (page - 1) * limit;
    const pagedItems = enriched.slice(offset, offset + limit).map((e) => e.item);

    return {
      range: toDashboardRangeMeta(range),
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
      },
      items: pagedItems,
    };
  }

  async getAdminExpiring(
    query: DashboardExpiringQueryDto,
  ): Promise<AdminExpiringResponse> {
    const now = new Date();
    const days = Math.min(90, Math.max(1, Number(query.days ?? 7)));
    const quotaThreshold = Math.min(
      1,
      Math.max(0, Number(query.quota_threshold ?? 0.8)),
    );
    const windowEndMs = now.getTime() + days * DAY_MS;

    const [subscriptions, businesses] = await Promise.all([
      this.subscriptionsRepository.find(),
      this.businessesRepository.find(),
    ]);

    const businessNameMap = new Map<string, string>();
    for (const business of businesses) {
      businessNameMap.set(business.id, business.business_name);
    }

    const expiring: AdminExpiringSubscriptionItem[] = [];
    const nearQuota: AdminNearQuotaSubscriptionItem[] = [];

    for (const sub of subscriptions) {
      if (sub.deleted_at) {
        continue;
      }

      const businessName =
        businessNameMap.get(sub.business_id) ?? 'Unknown Business';
      const periodEnd = new Date(sub.current_period_end);
      const periodEndMs = periodEnd.getTime();
      const quotaLimit = Number(sub.quota_limit);
      const quotaUsed = Number(sub.quota_used);
      const quotaRemaining = Number(sub.quota_remaining);

      if (
        sub.status === BusinessSubscriptionStatusEnum.ACTIVE &&
        periodEndMs >= now.getTime() &&
        periodEndMs <= windowEndMs
      ) {
        expiring.push({
          business_id: sub.business_id,
          business_name: businessName,
          subscription_id: sub.id,
          status: sub.status,
          current_period_end: periodEnd.toISOString(),
          days_remaining: this.computeDaysUntil(periodEnd, now),
          quota_remaining: quotaRemaining,
          quota_limit: quotaLimit,
        });
      }

      if (
        sub.status === BusinessSubscriptionStatusEnum.ACTIVE ||
        sub.status === BusinessSubscriptionStatusEnum.PAST_DUE
      ) {
        const utilization =
          quotaLimit > 0 ? this.roundMetric(quotaUsed / quotaLimit) : 0;
        if (quotaLimit > 0 && utilization >= quotaThreshold) {
          nearQuota.push({
            business_id: sub.business_id,
            business_name: businessName,
            subscription_id: sub.id,
            status: sub.status,
            current_period_end: periodEnd.toISOString(),
            quota_used: quotaUsed,
            quota_limit: quotaLimit,
            quota_remaining: quotaRemaining,
            utilization,
          });
        }
      }
    }

    expiring.sort(
      (a, b) =>
        new Date(a.current_period_end).getTime() -
        new Date(b.current_period_end).getTime(),
    );

    nearQuota.sort((a, b) => b.utilization - a.utilization);

    return {
      expiring,
      near_quota: nearQuota,
    };
  }
}
