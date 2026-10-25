import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import generatePayload from 'promptpay-qr';
import { toDataURL } from 'qrcode';
import { DataSource, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { ApiKeyUsageLog } from '../api-keys/entities/api-key-usage-log.entity';
import { ApiKey } from '../api-keys/entities/api-key.entity';
import { AuthUser } from '../auth/types/auth-user.type';
import { Business } from '../business/entities/business.entity';
import { BusinessService } from '../business/business.service';
import { getBangkokParts } from '../common/utils/datetime.util';
import { ApiKeyUsageActionEnum, PaymentOrderStatusEnum } from '../enums';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateLinkQrDto } from './dto/create-link-qr.dto';
import { CreateQrDto } from './dto/create-qr.dto';
import { PaymentOrder } from './entities/payment-order.entity';

const QR_TTL_MS = 5 * 60 * 1000;
const MAX_DECIMAL_REF = 99;

@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(PaymentOrder)
    private readonly ordersRepository: Repository<PaymentOrder>,
    @InjectRepository(ApiKey)
    private readonly apiKeysRepository: Repository<ApiKey>,
    private readonly businessService: BusinessService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly dataSource: DataSource,
  ) {}

  async createQrOrder(user: AuthUser, dto: CreateQrDto) {
    const business = await this.resolveActiveBusiness(user);

    // ต้องผูก LINE User ID ก่อน จึงจะสร้าง QR รับเงินได้
    if (!business.line_user_id) {
      throw new ForbiddenException(
        'Business is not linked to a LINE user yet; please link LINE before creating a QR',
      );
    }

    return this.createOrder(business, dto, user.apiKeyId ?? null);
  }

  /**
   * สร้าง QR ยืนยันสำหรับผูก LINE User ID เข้ากับ Business (ยอด 0.01 - 0.99)
   * เมื่อมี Webhook เงินเข้าที่มียอด/เวลาตรงกัน ระบบจะผูก `businesses.line_user_id`
   * ด้วย `source.userId` ของ LINE event นั้น
   *
   * ถ้าส่ง `redirect_url` มา ระบบจะยิง callback (event `line.linked`)
   * เมื่อ QR นี้ถูกชำระสำเร็จ เพื่อให้ client รู้ผลทันทีโดยไม่ต้อง polling
   */
  async createLineLinkOrder(user: AuthUser, dto: CreateLinkQrDto = {}) {
    const business = await this.resolveActiveBusiness(user);

    if (business.line_user_id) {
      throw new ConflictException('Business is already linked to a LINE user');
    }

    return this.createLinkOrder(business, dto.redirect_url ?? null);
  }

  private async resolveActiveBusiness(user: AuthUser): Promise<Business> {
    const businessId =
      user.businessId ?? (await this.businessService.findByUserId(user.userId))?.id;

    if (!businessId) {
      throw new UnauthorizedException('Business account not found');
    }

    const business = await this.businessService.findById(businessId);

    if (!business || !business.is_active) {
      throw new UnauthorizedException('Business is inactive or not found');
    }

    if (user.apiKeyId) {
      const apiKey = await this.apiKeysRepository.findOne({
        where: { id: user.apiKeyId, is_active: true },
      });

      if (
        !apiKey ||
        (apiKey.business_id && apiKey.business_id !== business.id)
      ) {
        throw new UnauthorizedException('API key is inactive or revoked');
      }
    }

    return business;
  }

  async findOrderById(orderId: string): Promise<PaymentOrder | null> {
    return this.ordersRepository.findOne({ where: { id: orderId } });
  }

  async getOrderOrFail(orderId: string): Promise<PaymentOrder> {
    const order = await this.findOrderById(orderId);

    if (!order) {
      throw new NotFoundException('Payment order not found');
    }

    return order;
  }

  private async createOrder(
    business: Business,
    dto: CreateQrDto,
    apiKeyId: string | null,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const ordersRepository = manager.getRepository(PaymentOrder);
      const now = new Date();

      // ตรวจสอบสิทธิ์แพ็กเกจ/โควต้า/Rate Limit ก่อนสร้าง Order
      await this.subscriptionsService.assertQuotaAndRateLimit(
        business.id,
        manager,
      );

      await ordersRepository.update(
        {
          status: PaymentOrderStatusEnum.UNVERIFIED,
          expires_at: LessThanOrEqual(now),
        },
        { status: PaymentOrderStatusEnum.EXPIRED },
      );

      const baseAmount = Math.floor(dto.amount);
      const decimalRef = await this.allocateDecimalRef(
        ordersRepository,
        baseAmount,
      );

      const totalAmount = Number((baseAmount + decimalRef).toFixed(2));
      const { dateStr, timeStr } = getBangkokParts(now);
      const amountStr = totalAmount.toFixed(2);
      const orderId = `${dateStr}${timeStr}_${amountStr}`;
      const lookupKey = `${dateStr}_${amountStr}`;
      const expiresAt = new Date(now.getTime() + QR_TTL_MS);

      const qrPayload = generatePayload(business.promptpay_id, {
        amount: totalAmount,
      });
      const qrImage = await toDataURL(qrPayload);

      const order = ordersRepository.create({
        id: orderId,
        lookup_key: lookupKey,
        business_id: business.id,
        api_key_id: apiKeyId,
        line_user_id: business.line_user_id,
        is_line_link: false,
        base_amount: baseAmount,
        decimal_ref: decimalRef,
        total_amount: totalAmount,
        qr_payload: qrPayload,
        redirect_url: dto.redirect_url,
        status: PaymentOrderStatusEnum.UNVERIFIED,
        callback_sent: false,
        callback_status_code: null,
        expires_at: expiresAt,
        paid_at: null,
      });

      await ordersRepository.save(order);

      if (apiKeyId) {
        const usageLogsRepository = manager.getRepository(ApiKeyUsageLog);

        await usageLogsRepository.save(
          usageLogsRepository.create({
            api_key_id: apiKeyId,
            business_id: business.id,
            payment_order_id: orderId,
            action: ApiKeyUsageActionEnum.QR_CREATED,
            quota_deducted: false,
          }),
        );

        await manager
          .getRepository(ApiKey)
          .update({ id: apiKeyId }, { last_used_at: now });
      }

      return {
        order_id: orderId,
        lookup_key: lookupKey,
        base_amount: baseAmount,
        decimal_ref: decimalRef,
        total_amount: totalAmount,
        qr_payload: qrPayload,
        qr_image: qrImage,
        status: order.status,
        redirect_url: order.redirect_url,
        expires_at: order.expires_at,
        api_key_id: order.api_key_id,
        line_user_id: order.line_user_id,
        is_line_link: order.is_line_link,
      };
    });
  }

  /**
   * Order สำหรับผูก LINE: ยอด 0.01 - 0.99 (ไม่คิดโควต้า/rate limit)
   * ยังไม่ทราบ LINE User ID ตอนสร้าง จึงเว้น `line_user_id` เป็น `null`
   * `redirectUrl` (optional) ใช้รับ callback `line.linked` เมื่อชำระสำเร็จ
   */
  private async createLinkOrder(business: Business, redirectUrl: string | null) {
    return this.dataSource.transaction(async (manager) => {
      const ordersRepository = manager.getRepository(PaymentOrder);
      const now = new Date();

      await ordersRepository.update(
        {
          status: PaymentOrderStatusEnum.UNVERIFIED,
          expires_at: LessThanOrEqual(now),
        },
        { status: PaymentOrderStatusEnum.EXPIRED },
      );

      const baseAmount = 0;
      const decimalRef = await this.allocateDecimalRef(
        ordersRepository,
        baseAmount,
      );
      const totalAmount = Number(decimalRef.toFixed(2));
      const { dateStr, timeStr } = getBangkokParts(now);
      const amountStr = totalAmount.toFixed(2);
      const orderId = `${dateStr}${timeStr}_${amountStr}`;
      const lookupKey = `${dateStr}_${amountStr}`;
      const expiresAt = new Date(now.getTime() + QR_TTL_MS);

      const qrPayload = generatePayload(business.promptpay_id, {
        amount: totalAmount,
      });
      const qrImage = await toDataURL(qrPayload);

      const order = ordersRepository.create({
        id: orderId,
        lookup_key: lookupKey,
        business_id: business.id,
        api_key_id: null,
        line_user_id: null,
        is_line_link: true,
        base_amount: baseAmount,
        decimal_ref: decimalRef,
        total_amount: totalAmount,
        qr_payload: qrPayload,
        redirect_url: redirectUrl,
        status: PaymentOrderStatusEnum.UNVERIFIED,
        callback_sent: false,
        callback_status_code: null,
        expires_at: expiresAt,
        paid_at: null,
      });

      await ordersRepository.save(order);

      return {
        order_id: orderId,
        lookup_key: lookupKey,
        base_amount: baseAmount,
        decimal_ref: decimalRef,
        total_amount: totalAmount,
        qr_payload: qrPayload,
        qr_image: qrImage,
        status: order.status,
        redirect_url: order.redirect_url,
        expires_at: order.expires_at,
        api_key_id: order.api_key_id,
        line_user_id: order.line_user_id,
        is_line_link: order.is_line_link,
      };
    });
  }

  private async allocateDecimalRef(
    ordersRepository: Repository<PaymentOrder>,
    baseAmount: number,
  ): Promise<number> {
    const now = new Date();

    const activeOrders = await ordersRepository.find({
      where: {
        base_amount: baseAmount,
        status: PaymentOrderStatusEnum.UNVERIFIED,
        expires_at: MoreThan(now),
      },
      select: { decimal_ref: true },
    });

    const usedRefs = new Set(
      activeOrders.map((order) => Number(order.decimal_ref).toFixed(2)),
    );

    for (let index = 1; index <= MAX_DECIMAL_REF; index += 1) {
      const candidate = index / 100;

      if (!usedRefs.has(candidate.toFixed(2))) {
        return candidate;
      }
    }

    throw new ConflictException(
      'No available decimal reference slot for this amount, please retry shortly',
    );
  }
}
