import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHmac } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ApiKeyUsageLog } from '../api-keys/entities/api-key-usage-log.entity';
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
      base_amount: 100,
      decimal_ref: 0.01,
      total_amount: 100.01,
      status: 'UNVERIFIED',
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

  describe('matchAndMarkPaid', () => {
    it('marks a matched order as PAID, deducts quota and logs QR_PAID', async () => {
      const order = buildOrder();
      queryBuilder.getOne.mockResolvedValue(order);
      subscriptionsService.deductQuotaOnPaid.mockResolvedValue(true);

      const result = await (service as any).matchAndMarkPaid(
        parsed,
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

      await (service as any).matchAndMarkPaid(parsed, 'message-1', {});

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

      await (service as any).matchAndMarkPaid(parsed, 'message-1', {});

      expect(
        subscriptionsService.deductQuotaOnPaid,
      ).toHaveBeenCalledTimes(1);
      expect(usageLogsRepository.save).not.toHaveBeenCalled();
    });

    it('records NO_MATCH and does not deduct quota when no order matches', async () => {
      queryBuilder.getOne.mockResolvedValue(null);

      const result = await (service as any).matchAndMarkPaid(
        parsed,
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
