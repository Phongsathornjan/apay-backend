import { HttpService } from '@nestjs/axios';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import { ApiKeyUsageLog } from '../api-keys/entities/api-key-usage-log.entity';
import { PaymentOrder } from '../payment/entities/payment-order.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { WebhookLog } from './entities/webhook-log.entity';
import { WebhookService } from './webhook.service';

describe('WebhookService', () => {
  let service: WebhookService;

  const webhookLogsRepository = {
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

  const buildOrder = (overrides: Partial<PaymentOrder> = {}): PaymentOrder =>
    ({
      id: 'order-1',
      lookup_key: '20261020_100.01',
      business_id: 'business-1',
      api_key_id: 'key-1',
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
        base_amount: 1,
        decimal_ref: 0,
        total_amount: 1,
        redirect_url: null,
        ...overrides,
      });

    it('matches a normal order by amount and datetime', async () => {
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
        'order.status = :status',
        { status: 'UNVERIFIED' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'order.expires_at >= :transferTime',
        { transferTime: expect.any(Date) },
      );
      expect(order.status).toBe('PAID');
      expect(subscriptionsService.deductQuotaOnPaid).toHaveBeenCalledWith(
        order,
        manager,
      );
      expect(usageLogsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          api_key_id: 'key-1',
          business_id: 'business-1',
          payment_order_id: '20261101_1.00',
          action: 'QR_PAID',
          quota_deducted: true,
        }),
      );
      expect(webhookLogsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          process_status: 'MATCHED',
          matched_order_id: '20261101_1.00',
          parsed_amount: 1,
          parsed_datetime: '20261101 22:57',
        }),
      );
    });

    it('logs quota_deducted = false when the subscription already expired', async () => {
      queryBuilder.getOne.mockResolvedValue(buildIosOrder());
      subscriptionsService.deductQuotaOnPaid.mockResolvedValue(false);

      await service.handleIosNotification(iosPayload);

      expect(usageLogsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'QR_PAID',
          quota_deducted: false,
        }),
      );
    });

    it('still deducts quota but skips the usage log for orders without api_key_id', async () => {
      queryBuilder.getOne.mockResolvedValue(
        buildIosOrder({ api_key_id: null }),
      );
      subscriptionsService.deductQuotaOnPaid.mockResolvedValue(true);

      await service.handleIosNotification(iosPayload);

      expect(subscriptionsService.deductQuotaOnPaid).toHaveBeenCalledTimes(1);
      expect(usageLogsRepository.save).not.toHaveBeenCalled();
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
          message_id: expect.stringMatching(/^ios-/),
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

    it('records callback_sent = false when the callback HTTP request fails', async () => {
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

    it('skips the callback when the order has no redirect_url', async () => {
      await (service as any).sendCallback(buildOrder({ redirect_url: null }));

      expect(httpService.post).not.toHaveBeenCalled();
      expect(ordersRepository.update).not.toHaveBeenCalled();
    });

    it('rejects an unsupported bank app without writing a webhook log', async () => {
      await expect(
        service.handleIosNotification({
          app: 'SCB_EASY',
          title: 'รายการเงินเข้า',
          body: 'จำนวนเงิน 1.00 บาท วันที่ 1 พ.ย. 69 22:57 น.',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(webhookLogsRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a payload that does not specify the bank app', async () => {
      await expect(
        service.handleIosNotification({
          title: 'รายการเงินเข้า',
          body: 'จำนวนเงิน 1.00 บาท',
        }),
      ).rejects.toThrow(
        'Unsupported bank app: missing. Supported apps: K_PLUS',
      );

      expect(webhookLogsRepository.save).not.toHaveBeenCalled();
    });

    it('accepts the bank app case-insensitively with surrounding spaces', async () => {
      queryBuilder.getOne.mockResolvedValue(null);

      const result = await service.handleIosNotification({
        ...iosPayload,
        app: '  k_plus ',
      });

      expect(result).toEqual({
        processed: 1,
        matched: false,
        order_id: null,
      });
      expect(dataSource.transaction).toHaveBeenCalled();
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

    it('prefers IOS_WEBHOOK_SECRET over the legacy KBANK_IOS_WEBHOOK_SECRET', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'IOS_WEBHOOK_SECRET') return 'new-secret';
        if (key === 'KBANK_IOS_WEBHOOK_SECRET') return 'legacy-secret';

        return undefined;
      });

      expect(service.verifyIosNotificationSecret('new-secret')).toBe(true);
      expect(service.verifyIosNotificationSecret('legacy-secret')).toBe(false);
    });
  });
});
