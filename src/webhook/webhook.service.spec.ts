import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHmac } from 'node:crypto';
import { of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import { ApiKeyUsageLog } from '../api-keys/entities/api-key-usage-log.entity';
import { Business } from '../business/entities/business.entity';
import { PaymentOrder } from '../payment/entities/payment-order.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WebhookLog } from './entities/webhook-log.entity';
import { WebhookService } from './webhook.service';

describe('WebhookService', () => {
  let service: WebhookService;

  const webhookLogsRepository = {
    exists: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const ordersRepository = {
    createQueryBuilder: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };

  const usageLogsRepository = {
    create: jest.fn(),
    save: jest.fn(),
  };

  const businessRepository = {
    findOne: jest.fn(),
    update: jest.fn(),
  };

  const queryBuilder = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };

  const manager = {
    getRepository: jest.fn(),
  };

  const dataSource = {
    transaction: jest.fn(),
    getRepository: jest.fn(),
  };

  const httpService = {
    post: jest.fn(),
  };

  const configService = {
    get: jest.fn(),
  };

  const subscriptionsService = {
    deductQuotaOnPaid: jest.fn(),
  };

  const parsed = {
    amount: '100.01',
    dateStr: '20261020',
    transferTime: new Date('2026-10-20T08:31:00.000Z'),
    datetimeStr: '20261020 15:31',
  };

  const buildOrder = (overrides: Partial<PaymentOrder> = {}): PaymentOrder =>
    ({
      id: 'order-1',
      lookup_key: '20261020_100.01',
      business_id: 'business-1',
      api_key_id: 'key-1',
      line_user_id: 'U-owner',
      is_line_link: false,
      base_amount: 100,
      decimal_ref: 0.01,
      total_amount: 100.01,
      status: 'UNVERIFIED',
      redirect_url: 'https://merchant.example.com/cb',
      ...overrides,
    }) as PaymentOrder;

  beforeEach(async () => {
    jest.clearAllMocks();

    manager.getRepository.mockImplementation((entity: unknown) => {
      if (entity === PaymentOrder) return ordersRepository;
      if (entity === WebhookLog) return webhookLogsRepository;
      if (entity === ApiKeyUsageLog) return usageLogsRepository;
      if (entity === Business) return businessRepository;

      throw new Error('Unknown repository');
    });

    dataSource.transaction.mockImplementation(
      async (callback: (m: unknown) => unknown) => callback(manager),
    );
    dataSource.getRepository.mockReturnValue(ordersRepository);

    ordersRepository.createQueryBuilder.mockReturnValue(queryBuilder);
    ordersRepository.save.mockImplementation(async (data) => data);
    ordersRepository.update.mockResolvedValue({ affected: 1 });

    webhookLogsRepository.create.mockImplementation((data) => data);
    webhookLogsRepository.save.mockImplementation(async (data) => data);
    usageLogsRepository.create.mockImplementation((data) => data);
    usageLogsRepository.save.mockImplementation(async (data) => data);
    businessRepository.findOne.mockResolvedValue(null);
    businessRepository.update.mockResolvedValue({ affected: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        {
          provide: getRepositoryToken(WebhookLog),
          useValue: webhookLogsRepository,
        },
        { provide: DataSource, useValue: dataSource },
        { provide: HttpService, useValue: httpService },
        { provide: ConfigService, useValue: configService },
        { provide: SubscriptionsService, useValue: subscriptionsService },
      ],
    }).compile();

    service = module.get<WebhookService>(WebhookService);
  });

  describe('matchAndMarkPaid', () => {
    it('marks a matched order as PAID, deducts quota and logs QR_PAID', async () => {
      const order = buildOrder();
      queryBuilder.getOne.mockResolvedValue(order);
      subscriptionsService.deductQuotaOnPaid.mockResolvedValue(true);

      const result = await (service as any).matchAndMarkPaid(
        parsed,
        'U-owner',
        'message-1',
        { event: 'message' },
      );

      expect(result).toBe(order);
      expect(order.status).toBe('PAID');
      expect(
        subscriptionsService.deductQuotaOnPaid,
      ).toHaveBeenCalledWith(order, manager);
      expect(usageLogsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          api_key_id: 'key-1',
          business_id: 'business-1',
          payment_order_id: 'order-1',
          action: 'QR_PAID',
          quota_deducted: true,
        }),
      );
      expect(webhookLogsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ process_status: 'MATCHED' }),
      );
    });

    it('logs quota_deducted = false when the subscription already expired', async () => {
      queryBuilder.getOne.mockResolvedValue(buildOrder());
      subscriptionsService.deductQuotaOnPaid.mockResolvedValue(false);

      await (service as any).matchAndMarkPaid(parsed, 'U-owner', 'message-1', {});

      expect(usageLogsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'QR_PAID',
          quota_deducted: false,
        }),
      );
    });

    it('still deducts quota but skips the usage log for legacy orders without api_key_id', async () => {
      queryBuilder.getOne.mockResolvedValue(buildOrder({ api_key_id: null }));
      subscriptionsService.deductQuotaOnPaid.mockResolvedValue(true);

      await (service as any).matchAndMarkPaid(parsed, 'U-owner', 'message-1', {});

      expect(
        subscriptionsService.deductQuotaOnPaid,
      ).toHaveBeenCalledTimes(1);
      expect(usageLogsRepository.save).not.toHaveBeenCalled();
    });

    it('records NO_MATCH and does not deduct quota when no order matches', async () => {
      queryBuilder.getOne.mockResolvedValue(null);

      const result = await (service as any).matchAndMarkPaid(
        parsed,
        'U-owner',
        'message-1',
        {},
      );

      expect(result).toBeNull();
      expect(subscriptionsService.deductQuotaOnPaid).not.toHaveBeenCalled();
      expect(webhookLogsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          process_status: 'NO_MATCH',
          matched_order_id: null,
        }),
      );
    });

    it('binds the business line_user_id when a LINE link order is paid', async () => {
      const linkOrder = buildOrder({
        id: '20261020_0.01',
        lookup_key: '20261020_0.01',
        api_key_id: null,
        line_user_id: null,
        is_line_link: true,
        base_amount: 0,
        decimal_ref: 0.01,
        total_amount: 0.01,
        redirect_url: null,
      });

      queryBuilder.getOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(linkOrder);
      businessRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'business-1', line_user_id: null });

      const result = await (service as any).matchAndMarkPaid(
        { ...parsed, amount: '0.01' },
        'U-owner',
        'message-link',
        {},
      );

      expect(result).toBe(linkOrder);
      expect(linkOrder.status).toBe('PAID');
      expect(linkOrder.line_user_id).toBe('U-owner');
      expect(businessRepository.update).toHaveBeenCalledWith(
        { id: 'business-1' },
        { line_user_id: 'U-owner' },
      );
      expect(
        subscriptionsService.deductQuotaOnPaid,
      ).not.toHaveBeenCalled();
      expect(usageLogsRepository.save).not.toHaveBeenCalled();
      expect(webhookLogsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ process_status: 'MATCHED' }),
      );
    });

    it('falls back to orders created before the business linked a LINE user', async () => {
      const order = buildOrder({ line_user_id: null });
      queryBuilder.getOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(order);
      subscriptionsService.deductQuotaOnPaid.mockResolvedValue(true);

      const result = await (service as any).matchAndMarkPaid(
        parsed,
        'U-owner',
        'message-1',
        {},
      );

      expect(result).toBe(order);
      expect(order.status).toBe('PAID');
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'order.line_user_id IS NULL',
      );
      expect(webhookLogsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ process_status: 'MATCHED' }),
      );
    });

    it('does not bind a LINE user that is already linked to another business', async () => {
      queryBuilder.getOne.mockResolvedValue(null);
      businessRepository.findOne.mockResolvedValueOnce({
        id: 'business-other',
        line_user_id: 'U-owner',
      });

      const result = await (service as any).matchAndMarkPaid(
        { ...parsed, amount: '0.01' },
        'U-owner',
        'message-link',
        {},
      );

      expect(result).toBeNull();
      expect(businessRepository.update).not.toHaveBeenCalled();
      expect(webhookLogsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ process_status: 'NO_MATCH' }),
      );
    });
  });

  describe('handleIosNotification', () => {
    const iosPayload = {
      app: 'K_PLUS',
      title: 'รายการเงินเข้า',
      body: 'บัญชี xxx-x-x8583-x  จำนวนเงิน 1.00 บาท  วันที่ 1 พ.ย. 69  22:57 น.',
    };

    const buildIosOrder = (overrides: Partial<PaymentOrder> = {}) =>
      buildOrder({
        id: '20261101_1.00',
        lookup_key: '20261101_1.00',
        line_user_id: null,
        base_amount: 1,
        decimal_ref: 0,
        total_amount: 1,
        redirect_url: null,
        ...overrides,
      });

    it('matches a normal order by amount and datetime without a LINE user id', async () => {
      const order = buildIosOrder();
      queryBuilder.getOne.mockResolvedValue(order);
      subscriptionsService.deductQuotaOnPaid.mockResolvedValue(true);

      const result = await service.handleIosNotification(iosPayload);

      expect(result).toEqual({
        processed: 1,
        matched: true,
        order_id: '20261101_1.00',
      });
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'order.lookup_key = :lookupKey',
        { lookupKey: '20261101_1.00' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'order.is_line_link = :isLineLink',
        { isLineLink: false },
      );
      expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
        'order.line_user_id = :lineUserId',
        expect.anything(),
      );
      expect(order.status).toBe('PAID');
      expect(
        subscriptionsService.deductQuotaOnPaid,
      ).toHaveBeenCalledWith(order, manager);
      expect(webhookLogsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          process_status: 'MATCHED',
          matched_order_id: '20261101_1.00',
          parsed_amount: 1,
          parsed_datetime: '20261101 22:57',
        }),
      );
    });

    it('records NO_MATCH when the notification body cannot be parsed', async () => {
      const result = await service.handleIosNotification({
        app: 'K_PLUS',
        title: 'รายการเงินเข้า',
        body: 'ไม่มียอดเงิน',
      });

      expect(result).toEqual({
        processed: 1,
        matched: false,
        order_id: null,
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(webhookLogsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          line_message_id: expect.stringMatching(/^ios-/),
          process_status: 'NO_MATCH',
        }),
      );
    });

    it('records NO_MATCH when no order matches the amount and time', async () => {
      queryBuilder.getOne.mockResolvedValue(null);

      const result = await service.handleIosNotification(iosPayload);

      expect(result).toEqual({
        processed: 1,
        matched: false,
        order_id: null,
      });
      expect(subscriptionsService.deductQuotaOnPaid).not.toHaveBeenCalled();
      expect(webhookLogsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          process_status: 'NO_MATCH',
          matched_order_id: null,
          parsed_amount: 1,
        }),
      );
    });

    it('sends a payment.paid callback when the matched order has a redirect_url', async () => {
      const order = buildIosOrder({
        redirect_url: 'https://merchant.example.com/cb',
      });
      queryBuilder.getOne.mockResolvedValue(order);
      subscriptionsService.deductQuotaOnPaid.mockResolvedValue(true);
      httpService.post.mockReturnValue(of({ status: 200 }));

      await service.handleIosNotification(iosPayload);

      expect(httpService.post).toHaveBeenCalledWith(
        'https://merchant.example.com/cb',
        expect.objectContaining({
          event: 'payment.paid',
          order_id: '20261101_1.00',
        }),
        { timeout: 5000 },
      );
      expect(ordersRepository.update).toHaveBeenCalledWith(
        { id: '20261101_1.00' },
        { callback_sent: true, callback_status_code: 200 },
      );
    });
  });

  describe('verifyIosNotificationSecret', () => {
    it('accepts any request when the secret is not configured', () => {
      configService.get.mockReturnValue(undefined);

      expect(service.verifyIosNotificationSecret()).toBe(true);
    });

    it('requires a matching x-webhook-secret when configured', () => {
      configService.get.mockImplementation((key: string) =>
        key === 'KBANK_IOS_WEBHOOK_SECRET' ? 'ios-secret' : undefined,
      );

      expect(service.verifyIosNotificationSecret('ios-secret')).toBe(true);
      expect(service.verifyIosNotificationSecret('wrong')).toBe(false);
      expect(service.verifyIosNotificationSecret()).toBe(false);
    });
  });

  describe('handleWebhook', () => {
    it('skips duplicate LINE message ids', async () => {
      webhookLogsRepository.exists.mockResolvedValue(true);

      const result = await service.handleWebhook({
        events: [
          {
            type: 'message',
            timestamp: 1792485060000,
            message: { type: 'text', id: 'message-1', text: 'เงินเข้า 1.00' },
          },
        ],
      });

      expect(result).toEqual({ processed: 0 });
      expect(webhookLogsRepository.exists).toHaveBeenCalledWith({
        where: { line_message_id: 'message-1' },
      });
    });

    it('ignores non-text events', async () => {
      const result = await service.handleWebhook({
        events: [
          {
            type: 'message',
            timestamp: 1792485060000,
            message: { type: 'image', id: 'message-2' },
          },
        ],
      });

      expect(result).toEqual({ processed: 0 });
    });

    it('logs NO_MATCH when text message is not a parseable KBank notification', async () => {
      webhookLogsRepository.exists.mockResolvedValue(false);

      const result = await service.handleWebhook({
        events: [
          {
            type: 'message',
            timestamp: 1792485060000,
            message: { type: 'text', id: 'message-3', text: 'สวัสดีครับ' },
          },
        ],
      });

      expect(result).toEqual({ processed: 1 });
      expect(webhookLogsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          line_message_id: 'message-3',
          process_status: 'NO_MATCH',
        }),
      );
    });

    it('matches a valid KBank message and sends callback to redirect_url', async () => {
      webhookLogsRepository.exists.mockResolvedValue(false);
      queryBuilder.getOne.mockResolvedValue(
        buildOrder({ redirect_url: 'https://merchant.example.com/cb' }),
      );
      subscriptionsService.deductQuotaOnPaid.mockResolvedValue(true);
      httpService.post.mockReturnValue(of({ status: 200 }));

      const result = await service.handleWebhook({
        events: [
          {
            type: 'message',
            timestamp: 1792485060000,
            message: {
              type: 'text',
              id: 'message-4',
              text: 'เงินเข้า จำนวน 100.01 บาท วันที่ 20/10/69 เวลา 15:31 น.',
            },
            source: { type: 'user', userId: 'U-owner' },
          },
        ],
      });

      expect(result).toEqual({ processed: 1 });
      expect(httpService.post).toHaveBeenCalledWith(
        'https://merchant.example.com/cb',
        expect.objectContaining({
          event: 'payment.paid',
          order_id: 'order-1',
        }),
        { timeout: 5000 },
      );
      expect(ordersRepository.update).toHaveBeenCalledWith(
        { id: 'order-1' },
        { callback_sent: true, callback_status_code: 200 },
      );
    });

    it('sends a line.linked callback when a LINE link order is paid', async () => {
      webhookLogsRepository.exists.mockResolvedValue(false);

      const linkOrder = buildOrder({
        id: '20261020_0.01',
        lookup_key: '20261020_0.01',
        api_key_id: null,
        line_user_id: null,
        is_line_link: true,
        base_amount: 0,
        decimal_ref: 0.01,
        total_amount: 0.01,
        redirect_url: 'http://localhost:3001/api/line-link/callback',
      });

      queryBuilder.getOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(linkOrder);
      businessRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'business-1', line_user_id: null });
      httpService.post.mockReturnValue(of({ status: 200 }));

      const result = await service.handleWebhook({
        events: [
          {
            type: 'message',
            timestamp: 1792485060000,
            message: {
              type: 'text',
              id: 'message-link-cb',
              text: 'เงินเข้า จำนวน 0.01 บาท วันที่ 20/10/69 เวลา 15:31 น.',
            },
            source: { type: 'user', userId: 'U-owner' },
          },
        ],
      });

      expect(result).toEqual({ processed: 1 });
      expect(httpService.post).toHaveBeenCalledWith(
        'http://localhost:3001/api/line-link/callback',
        expect.objectContaining({
          event: 'line.linked',
          is_line_link: true,
          order_id: '20261020_0.01',
        }),
        { timeout: 5000 },
      );
      expect(ordersRepository.update).toHaveBeenCalledWith(
        { id: '20261020_0.01' },
        { callback_sent: true, callback_status_code: 200 },
      );
    });

    it('logs NO_MATCH and skips matching when the event has no LINE user id', async () => {
      webhookLogsRepository.exists.mockResolvedValue(false);

      const result = await service.handleWebhook({
        events: [
          {
            type: 'message',
            timestamp: 1792485060000,
            message: {
              type: 'text',
              id: 'message-5',
              text: 'เงินเข้า จำนวน 100.01 บาท วันที่ 20/10/69 เวลา 15:31 น.',
            },
          },
        ],
      });

      expect(result).toEqual({ processed: 1 });
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(webhookLogsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          line_message_id: 'message-5',
          parsed_amount: 100.01,
          process_status: 'NO_MATCH',
        }),
      );
    });

    it('records callback_sent = false when callback HTTP request fails', async () => {
      await (service as any).sendCallback(
        buildOrder({ redirect_url: 'https://merchant.example.com/cb' }),
      );
      httpService.post.mockReturnValueOnce(
        throwError(() => ({
          message: 'Bad Gateway',
          response: { status: 502 },
        })),
      );

      await (service as any).sendCallback(
        buildOrder({ redirect_url: 'https://merchant.example.com/cb' }),
      );

      expect(ordersRepository.update).toHaveBeenLastCalledWith(
        { id: 'order-1' },
        { callback_sent: false, callback_status_code: 502 },
      );
    });
  });

  describe('verifySignature', () => {
    it('accepts a valid HMAC-SHA256 signature when verification is enabled', () => {
      configService.get.mockImplementation((key: string) =>
        key === 'VERIFY_LINE_SIGNATURE' ? 'true' : 'channel-secret',
      );

      const body = Buffer.from(JSON.stringify({ events: [] }));
      const signature = createHmac('sha256', 'channel-secret')
        .update(body)
        .digest('base64');

      expect(service.verifySignature(body, signature)).toBe(true);
      expect(service.verifySignature(body, 'invalid')).toBe(false);
    });

    it('skips verification when disabled', () => {
      configService.get.mockReturnValue(undefined);

      expect(service.verifySignature(undefined)).toBe(true);
    });
  });
});
