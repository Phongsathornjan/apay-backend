import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  DataSource,
  EntityManager,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { ApiKey } from '../api-keys/entities/api-key.entity';
import { ApiKeyUsageLog } from '../api-keys/entities/api-key-usage-log.entity';
import { Business } from '../business/entities/business.entity';
import { addMonthsClamped } from '../common/utils/datetime.util';
import { Package } from '../packages/entities/package.entity';
import { PaymentOrder } from '../payment/entities/payment-order.entity';
import { BusinessSubscription } from './entities/business-subscription.entity';
import { SubscriptionPeriod } from './entities/subscription-period.entity';

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * จัดการ Master Package → Business Subscription แบบ Prepaid (Paid-through)
 *
 * กติกาสำคัญ:
 * - 1 Business มี Subscription ที่ใช้งานอยู่ได้เพียง 1 รายการ
 * - `current_period_end` คือวันที่ชำระเงินล่วงหน้าถึง (ไม่ใช่แค่วันรีเซ็ตโควต้า)
 * - เมื่อเลยกำหนดแล้วยังไม่ชำระ ระบบจะเปลี่ยนเป็น `PAST_DUE` และ `quota_remaining = 0`
 *   โดย **ไม่รีเซ็ตโควต้าให้ฟรี** และไม่มี grace period
 * - การรีเซ็ตโควต้าเกิดจาก `assignOrChangePackage()` หรือ `renewSubscription()` เท่านั้น
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(BusinessSubscription)
    private readonly subscriptionsRepository: Repository<BusinessSubscription>,
    @InjectRepository(SubscriptionPeriod)
    private readonly periodsRepository: Repository<SubscriptionPeriod>,
    @InjectRepository(Package)
    private readonly packagesRepository: Repository<Package>,
    @InjectRepository(Business)
    private readonly businessesRepository: Repository<Business>,
    @InjectRepository(ApiKey)
    private readonly apiKeysRepository: Repository<ApiKey>,
    @InjectRepository(ApiKeyUsageLog)
    private readonly usageLogsRepository: Repository<ApiKeyUsageLog>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * ผูกหรือเปลี่ยน Package ให้ Business ภายใน Transaction เดียว
   * เริ่มรอบบิลใหม่และรีเซ็ตโควต้าตาม Package ใหม่ทันที
   */
  async assignOrChangePackage(
    businessId: string,
    packageId: string,
  ): Promise<BusinessSubscription> {
    const business = await this.businessesRepository.findOne({
      where: { id: businessId },
    });

    if (!business) {
      throw new NotFoundException('Business not found');
    }

    if (!business.is_active) {
      throw new BadRequestException('Business is inactive');
    }

    const pkg = await this.packagesRepository.findOne({
      where: { id: packageId },
    });

    if (!pkg || !pkg.is_active) {
      throw new BadRequestException('Package is not available');
    }

    return this.dataSource.transaction((manager) =>
      this.applyPackageToSubscription(businessId, pkg, manager),
    );
  }

  /**
   * ต่ออายุรอบบิล (Admin) — รีเซ็ตโควต้าและเปิดใช้งาน Subscription อีกครั้ง
   * หากต่ออายุก่อนครบกำหนดจะรักษาวันหมดอายุเดิมด้วยการตั้ง period start
   * ต่อจาก `current_period_end` (ไม่ใช่ now)
   */
  async renewSubscription(
    subscriptionId: string,
    packageId?: string,
  ): Promise<BusinessSubscription> {
    return this.dataSource.transaction(async (manager) => {
      const subscriptionsRepository =
        manager.getRepository(BusinessSubscription);

      const subscription = await subscriptionsRepository.findOne({
        where: { id: subscriptionId },
      });

      if (!subscription) {
        throw new NotFoundException('Subscription not found');
      }

      if (subscription.status === 'CANCELLED') {
        throw new BadRequestException('Subscription is cancelled');
      }

      const packagesRepository = manager.getRepository(Package);
      const pkg = await packagesRepository.findOne({
        where: { id: packageId ?? subscription.package_id },
      });

      if (!pkg) {
        throw new BadRequestException('Package is not available');
      }

      if (packageId && !pkg.is_active) {
        throw new BadRequestException('Package is not active');
      }

      const now = new Date();
      const periodStart =
        subscription.current_period_end > now
          ? subscription.current_period_end
          : now;

      return this.applyPackageToSubscription(
        subscription.business_id,
        pkg,
        manager,
        periodStart,
      );
    });
  }

  /**
   * Private Function 1 — Map ค่าจาก Package ลง Subscription และเริ่มรอบบิลใหม่
   * (รีเซ็ตโควต้าเฉพาะฟังก์ชันนี้เท่านั้น)
   */
  private async applyPackageToSubscription(
    businessId: string,
    pkg: Package,
    manager: EntityManager,
    periodStart?: Date,
  ): Promise<BusinessSubscription> {
    const subscriptionsRepository = manager.getRepository(BusinessSubscription);
    const now = new Date();

    const existing = await subscriptionsRepository.findOne({
      where: [
        { business_id: businessId, status: 'ACTIVE' },
        { business_id: businessId, status: 'PAST_DUE' },
      ],
      order: { created_at: 'DESC' },
    });

    if (existing && existing.quota_used > 0) {
      await this.snapshotPeriod(existing, manager);
    }

    const start = periodStart ?? now;
    const values: Partial<BusinessSubscription> = {
      package_id: pkg.id,
      status: 'ACTIVE',
      quota_limit: pkg.quota_limit,
      quota_used: 0,
      quota_remaining: pkg.quota_limit,
      rate_limit_per_hour: pkg.rate_limit_per_hour,
      max_api_keys: pkg.max_api_keys,
      current_period_start: start,
      current_period_end: addMonthsClamped(
        start,
        pkg.billing_cycle_months || 1,
      ),
      cancelled_at: null,
      last_payment_at: now,
    };

    if (existing) {
      Object.assign(existing, values);

      return subscriptionsRepository.save(existing);
    }

    return subscriptionsRepository.save(
      subscriptionsRepository.create({ business_id: businessId, ...values }),
    );
  }

  /**
   * Private Function 2 — Lazy Expiry: ตัดสิทธิ์เมื่อเลยวันจ่ายถึง (paid-through)
   * บันทึก Snapshot รอบที่จบลง, เปลี่ยนเป็น `PAST_DUE` และตั้งโควต้าคงเหลือเป็น 0
   * โดย **ไม่รีเซ็ตโควต้า** และไม่มี grace period
   */
  private async expireIfPastDue(
    subscription: BusinessSubscription,
    manager?: EntityManager,
  ): Promise<BusinessSubscription> {
    if (subscription.status !== 'ACTIVE') {
      return subscription;
    }

    const now = new Date();

    if (now < new Date(subscription.current_period_end)) {
      return subscription;
    }

    await this.snapshotPeriod(subscription, this.resolveManager(manager));

    subscription.status = 'PAST_DUE';
    subscription.quota_remaining = 0;

    const repository =
      manager?.getRepository(BusinessSubscription) ??
      this.subscriptionsRepository;

    return repository.save(subscription);
  }

  /**
   * Private Function 3 — บันทึก Snapshot ของรอบบิลที่จบลง
   */
  private async snapshotPeriod(
    subscription: BusinessSubscription,
    manager: EntityManager,
  ): Promise<SubscriptionPeriod> {
    const periodsRepository = manager.getRepository(SubscriptionPeriod);

    return periodsRepository.save(
      periodsRepository.create({
        subscription_id: subscription.id,
        business_id: subscription.business_id,
        package_id: subscription.package_id,
        period_start: subscription.current_period_start,
        period_end: subscription.current_period_end,
        quota_limit: subscription.quota_limit,
        quota_used: subscription.quota_used,
      }),
    );
  }

  /**
   * ดึง Subscription ล่าสุดของ Business พร้อมตรวจ Lazy Expiry
   */
  async getCurrentSubscription(
    businessId: string,
    manager?: EntityManager,
  ): Promise<BusinessSubscription | null> {
    const repository =
      manager?.getRepository(BusinessSubscription) ??
      this.subscriptionsRepository;

    const subscription = await repository.findOne({
      where: { business_id: businessId },
      order: { created_at: 'DESC' },
    });

    if (!subscription) {
      return null;
    }

    return this.expireIfPastDue(subscription, manager);
  }

  /**
   * ตรวจสอบสิทธิ์ก่อนสร้าง QR:
   * - ต้องมี Subscription ที่ `ACTIVE` และยังไม่เลย paid-through (ถ้า `PAST_DUE` → 403)
   * - ต้องมีโควต้าคงเหลือ (ไม่พอ → 429)
   * - จำนวน QR ที่สร้างใน 60 นาทีล่าสุดต้องไม่เกิน `rate_limit_per_hour` (เกิน → 429)
   */
  async assertQuotaAndRateLimit(
    businessId: string,
    manager?: EntityManager,
  ): Promise<BusinessSubscription> {
    const subscription = await this.getCurrentSubscription(businessId, manager);

    if (!subscription || subscription.status !== 'ACTIVE') {
      throw new ForbiddenException('Business package is inactive or unpaid');
    }

    if (subscription.quota_remaining <= 0) {
      throw new HttpException(
        'Monthly package quota exceeded',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const usageLogsRepository =
      manager?.getRepository(ApiKeyUsageLog) ?? this.usageLogsRepository;

    const hourAgo = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const requestsInLastHour = await usageLogsRepository.count({
      where: {
        business_id: businessId,
        action: 'QR_CREATED',
        created_at: MoreThanOrEqual(hourAgo),
      },
    });

    if (requestsInLastHour >= subscription.rate_limit_per_hour) {
      throw new HttpException(
        'Hourly rate limit exceeded for this business',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return subscription;
  }

  /**
   * หักโควต้าเมื่อ "สร้าง QR + จ่ายเงินสำเร็จ" ครบเงื่อนไข
   * ใช้ `pessimistic_write` lock ภายใน Transaction ของ Webhook
   * เพื่อกันการหักโควต้าซ้ำเมื่อมีรายการโอนเข้าพร้อมกัน
   */
  async deductQuotaOnPaid(
    order: PaymentOrder,
    manager: EntityManager,
  ): Promise<boolean> {
    const subscriptionsRepository = manager.getRepository(BusinessSubscription);

    const subscription = await subscriptionsRepository
      .createQueryBuilder('subscription')
      .setLock('pessimistic_write')
      .where('subscription.business_id = :businessId', {
        businessId: order.business_id,
      })
      .orderBy('subscription.created_at', 'DESC')
      .getOne();

    if (!subscription) {
      return false;
    }

    const current = await this.expireIfPastDue(subscription, manager);

    if (current.status !== 'ACTIVE' || current.quota_remaining <= 0) {
      return false;
    }

    current.quota_remaining -= 1;
    current.quota_used += 1;
    await subscriptionsRepository.save(current);

    return true;
  }

  /**
   * Cron รายชั่วโมง — ทำหน้าที่ "ตัดสิทธิ์" Subscription ที่เลยวันจ่ายถึง
   * ไม่ใช่การรีเซ็ตโควต้า (ลูกค้าที่ไม่ชำระเงินจะไม่ได้โควต้าฟรี)
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleHourlyBillingEnforcement(): Promise<void> {
    const expiredSubscriptions = await this.subscriptionsRepository.find({
      where: {
        status: 'ACTIVE',
        current_period_end: LessThanOrEqual(new Date()),
      },
    });

    for (const subscription of expiredSubscriptions) {
      try {
        await this.expireIfPastDue(subscription);
      } catch (error) {
        this.logger.warn(
          `Failed to expire subscription ${subscription.id}: ${
            (error as Error).message
          }`,
        );
      }
    }
  }

  /**
   * รายละเอียด Subscription ปัจจุบัน + จำนวน API Key + ประวัติรอบบิล
   */
  async getBusinessSubscriptionDetails(businessId: string) {
    const subscription = await this.getCurrentSubscription(businessId);

    const [activeKeyCount, periods] = await Promise.all([
      this.apiKeysRepository.count({ where: { business_id: businessId } }),
      this.periodsRepository.find({
        where: { business_id: businessId },
        order: { created_at: 'DESC' },
      }),
    ]);

    return {
      business_id: businessId,
      subscription: subscription
        ? this.toSubscriptionSummary(subscription)
        : null,
      api_keys: {
        used: activeKeyCount,
        max: subscription?.max_api_keys ?? 0,
      },
      periods,
    };
  }

  /**
   * สรุปการใช้งานรอบปัจจุบัน + แยกตาม API Key
   */
  async getBusinessUsage(businessId: string) {
    const subscription = await this.getCurrentSubscription(businessId);

    const hourAgo = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const currentHourRequests = await this.usageLogsRepository.count({
      where: {
        business_id: businessId,
        action: 'QR_CREATED',
        created_at: MoreThanOrEqual(hourAgo),
      },
    });

    const keys = await this.apiKeysRepository.find({
      where: { business_id: businessId },
      order: { created_at: 'DESC' },
      withDeleted: true,
    });

    const keysBreakdown = await Promise.all(
      keys.map(async (key) => {
        const [qrCreatedCount, qrPaidCount, quotaDeductedCount] =
          await Promise.all([
            this.usageLogsRepository.count({
              where: { api_key_id: key.id, action: 'QR_CREATED' },
            }),
            this.usageLogsRepository.count({
              where: { api_key_id: key.id, action: 'QR_PAID' },
            }),
            this.usageLogsRepository.count({
              where: {
                api_key_id: key.id,
                action: 'QR_PAID',
                quota_deducted: true,
              },
            }),
          ]);

        return {
          api_key_id: key.id,
          name: key.name,
          key_prefix: key.key_prefix,
          is_active: key.is_active,
          deleted_at: key.deleted_at,
          qr_created_count: qrCreatedCount,
          qr_paid_count: qrPaidCount,
          quota_deducted_count: quotaDeductedCount,
          last_used_at: key.last_used_at,
        };
      }),
    );

    return {
      business_id: businessId,
      subscription: subscription
        ? this.toSubscriptionSummary(subscription)
        : null,
      current_hour_requests: currentHourRequests,
      keys_breakdown: keysBreakdown,
    };
  }

  private toSubscriptionSummary(subscription: BusinessSubscription) {
    return {
      id: subscription.id,
      business_id: subscription.business_id,
      package_id: subscription.package_id,
      status: subscription.status,
      quota_limit: subscription.quota_limit,
      quota_used: subscription.quota_used,
      quota_remaining: subscription.quota_remaining,
      rate_limit_per_hour: subscription.rate_limit_per_hour,
      max_api_keys: subscription.max_api_keys,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      last_payment_at: subscription.last_payment_at,
      cancelled_at: subscription.cancelled_at,
      created_at: subscription.created_at,
      updated_at: subscription.updated_at,
    };
  }

  private resolveManager(manager?: EntityManager): EntityManager {
    return manager ?? this.subscriptionsRepository.manager;
  }
}
