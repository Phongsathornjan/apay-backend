import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { AxiosError } from 'axios';
import { randomUUID } from 'node:crypto';
import { firstValueFrom } from 'rxjs';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ApiKeyUsageLog } from '../api-keys/entities/api-key-usage-log.entity';
import { safeCompare } from '../common/utils/crypto.util';
import {
  ApiKeyUsageActionEnum,
  PaymentOrderStatusEnum,
  WebhookProcessStatusEnum,
} from '../enums';
import { PaymentOrder } from '../payment/entities/payment-order.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WebhookLog } from './entities/webhook-log.entity';
import type { IosNotificationBody } from './types/ios-notification.type';
import {
  parseIosNotification,
  resolveBankApp,
  SUPPORTED_BANK_APPS,
} from './utils/ios-notification.parser';
import { ParsedKBankMessage } from './utils/kbank-message.parser';

interface CallbackPayload {
  ok: boolean;
  event: 'payment.paid';
  order_id: string;
  lookup_key: string;
  business_id: string;
  base_amount: number;
  decimal_ref: number;
  total_amount: number;
  status: string;
  paid_at: Date | null;
}

export interface IosNotificationResult {
  /** จำนวน payload ที่ถูกประมวลผล (1 รายการต่อ 1 request) */
  processed: number;
  /** `true` เมื่อจับคู่ Order และปิดยอดเป็น PAID สำเร็จ */
  matched: boolean;
  /** Order ที่ถูกจับคู่ (null เมื่อไม่พบ) */
  order_id: string | null;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectRepository(WebhookLog)
    private readonly webhookLogsRepository: Repository<WebhookLog>,
    private readonly dataSource: DataSource,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  /**
   * ตรวจสอบ shared secret ของ endpoint `/ios-notify` (Header `x-webhook-secret`)
   * - ใช้ `IOS_WEBHOOK_SECRET` เป็นหลัก และถอยไปใช้ `KBANK_IOS_WEBHOOK_SECRET`
   *   (ชื่อเดิม) เพื่อไม่ให้ deployment ที่ยังตั้ง Env เก่าอยู่หยุดทำงาน
   * - ถ้าไม่ได้ตั้งทั้งสองตัว → เปิดให้เรียกได้ (ใช้ตอน dev)
   * - ถ้าตั้งไว้ → ต้องส่ง Header ให้ตรงเท่านั้น
   */
  verifyIosNotificationSecret(secret?: string): boolean {
    const expected =
      this.configService.get<string>('IOS_WEBHOOK_SECRET') ||
      this.configService.get<string>('KBANK_IOS_WEBHOOK_SECRET');

    if (!expected) {
      return true;
    }

    if (!secret) {
      return false;
    }

    return safeCompare(secret, expected);
  }

  /**
   * ตรวจว่าฟิลด์ `app` เป็นธนาคารที่ระบบรองรับ
   * ถ้าไม่ใช่ (หรือไม่ส่งมา) → `400 Bad Request` พร้อมรายชื่อธนาคารที่รองรับ
   */
  private assertSupportedBankApp(app: unknown): void {
    if (resolveBankApp(app)) {
      return;
    }

    const received =
      typeof app === 'string' && app.trim() ? `"${app.trim()}"` : 'missing';

    throw new BadRequestException(
      `Unsupported bank app: ${received}. Supported apps: ${SUPPORTED_BANK_APPS.join(', ')}`,
    );
  }

  /**
   * รับแจ้งเตือนเงินเข้าจากแอปธนาคารที่ iOS Shortcut ส่งต่อมา
   * (`{ app, title, body }`) แล้วจับคู่กับ Order ด้วยยอดเงิน + วันเวลา
   *
   * ฟิลด์ `app` เป็นตัวเลือก parser ของแต่ละธนาคาร (ตอนนี้รองรับ `K_PLUS` เท่านั้น)
   * ถ้าเป็นธนาคารที่ยังไม่รองรับ จะตอบ `400 Bad Request` กลับไปโดยไม่บันทึก log
   *
   * Idempotency: ใช้สถานะ Order เป็นตัวกันซ้ำ (จับคู่ได้เฉพาะ `UNVERIFIED`)
   * ดังนั้นการยิงซ้ำจะกลายเป็น `NO_MATCH` และไม่หักโควต้าซ้ำ
   */
  async handleIosNotification(
    payload: IosNotificationBody,
  ): Promise<IosNotificationResult> {
    this.assertSupportedBankApp(payload?.app);

    // ไม่มี message id จากต้นทาง → สร้างขึ้นใหม่เพื่อให้บันทึกลง webhook_logs ได้
    const messageId = `ios-${randomUUID()}`;
    const rawPayload = (payload ?? {}) as unknown as Record<string, unknown>;
    const parsed = parseIosNotification(payload);

    if (!parsed) {
      await this.saveLog({
        message_id: messageId,
        parsed_amount: null,
        parsed_datetime: null,
        raw_payload: rawPayload,
        process_status: WebhookProcessStatusEnum.NO_MATCH,
      });

      return { processed: 1, matched: false, order_id: null };
    }

    const order = await this.matchAndMarkPaidByAmountAndTime(
      parsed,
      messageId,
      rawPayload,
    );

    if (order?.redirect_url) {
      await this.sendCallback(order);
    }

    return {
      processed: 1,
      matched: order !== null,
      order_id: order?.id ?? null,
    };
  }

  /**
   * จับคู่ Order ด้วยยอดเงิน + วันเวลาเท่านั้น
   */
  private async matchAndMarkPaidByAmountAndTime(
    parsed: ParsedKBankMessage,
    messageId: string,
    rawPayload: Record<string, unknown>,
  ): Promise<PaymentOrder | null> {
    const lookupKey = `${parsed.dateStr}_${parsed.amount}`;

    return this.dataSource.transaction(async (manager) => {
      const order = await this.findUnverifiedOrder(
        manager,
        lookupKey,
        parsed.transferTime,
      );

      return this.finalizeMatchedOrder(
        manager,
        order,
        parsed,
        messageId,
        rawPayload,
      );
    });
  }

  /**
   * ค้นหา Order ที่ยังไม่หมดอายุและยังไม่ถูกชำระ โดยจับคู่ด้วยยอด + เวลา
   */
  private async findUnverifiedOrder(
    manager: EntityManager,
    lookupKey: string,
    transferTime: Date,
  ): Promise<PaymentOrder | null> {
    return manager
      .getRepository(PaymentOrder)
      .createQueryBuilder('order')
      .setLock('pessimistic_write')
      .where('order.lookup_key = :lookupKey', { lookupKey })
      .andWhere('order.status = :status', {
        status: PaymentOrderStatusEnum.UNVERIFIED,
      })
      .andWhere('order.expires_at >= :transferTime', { transferTime })
      .orderBy('order.created_at', 'DESC')
      .getOne();
  }

  /**
   * ปิดยอด Order ที่จับคู่ได้ (PAID + หักโควต้า + usage log) และบันทึก `webhook_logs`
   */
  private async finalizeMatchedOrder(
    manager: EntityManager,
    order: PaymentOrder | null,
    parsed: ParsedKBankMessage,
    messageId: string,
    rawPayload: Record<string, unknown>,
  ): Promise<PaymentOrder | null> {
    const webhookLogsRepository = manager.getRepository(WebhookLog);

    if (!order) {
      await webhookLogsRepository.save(
        webhookLogsRepository.create({
          message_id: messageId,
          matched_order_id: null,
          parsed_amount: Number(parsed.amount),
          parsed_datetime: parsed.datetimeStr,
          raw_payload: rawPayload,
          process_status: WebhookProcessStatusEnum.NO_MATCH,
        }),
      );

      return null;
    }

    const ordersRepository = manager.getRepository(PaymentOrder);

    order.status = PaymentOrderStatusEnum.PAID;
    order.paid_at = new Date();
    await ordersRepository.save(order);

    // ครบเงื่อนไข "สร้าง QR + จ่ายเงินสำเร็จ" → หักโควต้า 1 ครั้ง
    const quotaDeducted = await this.subscriptionsService.deductQuotaOnPaid(
      order,
      manager,
    );

    if (order.api_key_id) {
      const usageLogsRepository = manager.getRepository(ApiKeyUsageLog);

      await usageLogsRepository.save(
        usageLogsRepository.create({
          api_key_id: order.api_key_id,
          business_id: order.business_id,
          payment_order_id: order.id,
          action: ApiKeyUsageActionEnum.QR_PAID,
          quota_deducted: quotaDeducted,
        }),
      );
    }

    await webhookLogsRepository.save(
      webhookLogsRepository.create({
        message_id: messageId,
        matched_order_id: order.id,
        parsed_amount: Number(parsed.amount),
        parsed_datetime: parsed.datetimeStr,
        raw_payload: rawPayload,
        process_status: WebhookProcessStatusEnum.MATCHED,
      }),
    );

    return order;
  }

  private async sendCallback(order: PaymentOrder): Promise<void> {
    if (!order.redirect_url) {
      return;
    }

    const payload: CallbackPayload = {
      ok: true,
      event: 'payment.paid',
      order_id: order.id,
      lookup_key: order.lookup_key,
      business_id: order.business_id,
      base_amount: order.base_amount,
      decimal_ref: order.decimal_ref,
      total_amount: order.total_amount,
      status: order.status,
      paid_at: order.paid_at,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post(order.redirect_url, payload, { timeout: 5000 }),
      );

      await this.updateCallbackResult(order.id, true, response.status);
    } catch (error) {
      const axiosError = error as AxiosError;
      const statusCode = axiosError.response?.status ?? null;

      this.logger.warn(
        `Callback to ${order.redirect_url} failed: ${axiosError.message}`,
      );

      await this.updateCallbackResult(order.id, false, statusCode);
    }
  }

  private async updateCallbackResult(
    orderId: string,
    sent: boolean,
    statusCode: number | null,
  ): Promise<void> {
    await this.dataSource
      .getRepository(PaymentOrder)
      .update(
        { id: orderId },
        { callback_sent: sent, callback_status_code: statusCode },
      );
  }

  private async saveLog(data: {
    message_id: string;
    matched_order_id?: string | null;
    parsed_amount?: number | null;
    parsed_datetime?: string | null;
    raw_payload: Record<string, unknown>;
    process_status: WebhookLog['process_status'];
  }): Promise<WebhookLog> {
    const log = this.webhookLogsRepository.create({
      matched_order_id: null,
      parsed_amount: null,
      parsed_datetime: null,
      ...data,
    });

    return this.webhookLogsRepository.save(log);
  }
}
