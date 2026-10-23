import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { AxiosError } from 'axios';
import { createHmac } from 'node:crypto';
import { firstValueFrom } from 'rxjs';
import { DataSource, Repository } from 'typeorm';
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
import {
  LineWebhookBody,
  LineWebhookEvent,
} from './types/line-webhook.type';
import {
  ParsedKBankMessage,
  parseKBankMessage,
} from './utils/kbank-message.parser';

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
   * ตรวจสอบ Header `x-line-signature` ด้วย HMAC-SHA256
   * สามารถปิดได้ในโหมด development ผ่าน Env `VERIFY_LINE_SIGNATURE=false`
   */
  verifySignature(rawBody: Buffer | undefined, signature?: string): boolean {
    const verifyEnabled =
      this.configService.get<string>('VERIFY_LINE_SIGNATURE') === 'true';

    if (!verifyEnabled) {
      return true;
    }

    const channelSecret = this.configService.get<string>('LINE_CHANNEL_SECRET');

    if (!channelSecret || !signature || !rawBody) {
      return false;
    }

    const digest = createHmac('sha256', channelSecret)
      .update(rawBody)
      .digest('base64');

    return safeCompare(digest, signature);
  }

  async handleWebhook(body: LineWebhookBody): Promise<{ processed: number }> {
    const events = Array.isArray(body?.events) ? body.events : [];
    let processed = 0;

    for (const event of events) {
      if (event?.type !== 'message' || event?.message?.type !== 'text') {
        continue;
      }

      const messageId = event.message.id;

      if (!messageId) {
        continue;
      }

      const isDuplicate = await this.webhookLogsRepository.exists({
        where: { line_message_id: messageId },
      });

      if (isDuplicate) {
        this.logger.debug(`Duplicate LINE message ignored: ${messageId}`);
        continue;
      }

      await this.processEvent(event);
      processed += 1;
    }

    return { processed };
  }

  private async processEvent(event: LineWebhookEvent): Promise<void> {
    const messageId = event.message?.id as string;
    const text = event.message?.text ?? '';
    const rawPayload = event as unknown as Record<string, unknown>;
    const parsed = parseKBankMessage(text, event.timestamp);

    if (!parsed) {
      await this.saveLog({
        line_message_id: messageId,
        raw_payload: rawPayload,
        process_status: WebhookProcessStatusEnum.NO_MATCH,
      });
      return;
    }

    const order = await this.matchAndMarkPaid(parsed, messageId, rawPayload);

    if (order) {
      await this.sendCallback(order);
    }
  }

  private async matchAndMarkPaid(
    parsed: ParsedKBankMessage,
    messageId: string,
    rawPayload: Record<string, unknown>,
  ): Promise<PaymentOrder | null> {
    const lookupKey = `${parsed.dateStr}_${parsed.amount}`;

    return this.dataSource.transaction(async (manager) => {
      const order = await manager
        .getRepository(PaymentOrder)
        .createQueryBuilder('order')
        .setLock('pessimistic_write')
        .where('order.lookup_key = :lookupKey', { lookupKey })
        .andWhere('order.status = :status', {
          status: PaymentOrderStatusEnum.UNVERIFIED,
        })
        .andWhere('order.expires_at >= :transferTime', {
          transferTime: parsed.transferTime,
        })
        .orderBy('order.created_at', 'DESC')
        .getOne();

      const webhookLogsRepository = manager.getRepository(WebhookLog);

      if (!order) {
        await webhookLogsRepository.save(
          webhookLogsRepository.create({
            line_message_id: messageId,
            matched_order_id: null,
            parsed_amount: Number(parsed.amount),
            parsed_datetime: parsed.datetimeStr,
            raw_payload: rawPayload,
            process_status: WebhookProcessStatusEnum.NO_MATCH,
          }),
        );

        return null;
      }

      order.status = PaymentOrderStatusEnum.PAID;
      order.paid_at = new Date();
      await manager.getRepository(PaymentOrder).save(order);

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
          line_message_id: messageId,
          matched_order_id: order.id,
          parsed_amount: Number(parsed.amount),
          parsed_datetime: parsed.datetimeStr,
          raw_payload: rawPayload,
          process_status: WebhookProcessStatusEnum.MATCHED,
        }),
      );

      return order;
    });
  }

  private async sendCallback(order: PaymentOrder): Promise<void> {
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
      .update({ id: orderId }, { callback_sent: sent, callback_status_code: statusCode });
  }

  private async saveLog(data: {
    line_message_id: string;
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
