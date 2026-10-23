import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiKeyUsageLog } from '../api-keys/entities/api-key-usage-log.entity';
import { ApiKey } from '../api-keys/entities/api-key.entity';
import { AuthUser } from '../auth/types/auth-user.type';
import { BusinessService } from '../business/business.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PaymentOrder } from './entities/payment-order.entity';
import { PaymentService } from './payment.service';

describe('PaymentService', () => {
  let service: PaymentService;

  const ordersRepository = {
    update: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const apiKeysRepository = {
    findOne: jest.fn(),
    update: jest.fn(),
  };

  const usageLogsRepository = {
    create: jest.fn(),
    save: jest.fn(),
  };

  const businessService = {
    findById: jest.fn(),
    findByUserId: jest.fn(),
  };

  const subscriptionsService = {
    assertQuotaAndRateLimit: jest.fn(),
  };

  const manager = {
    getRepository: jest.fn(),
  };

  const dataSource = {
    transaction: jest.fn(),
  };

  const user: AuthUser = {
    userId: 'user-1',
    username: 'merchant',
    role: 'business',
    businessId: 'business-1',
    apiKeyId: 'key-1',
  };

  const dto = {
    amount: 100.49,
    redirect_url: 'https://merchant.example.com/webhooks/apay',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    manager.getRepository.mockImplementation((entity: unknown) => {
      if (entity === PaymentOrder) return ordersRepository;
      if (entity === ApiKeyUsageLog) return usageLogsRepository;
      if (entity === ApiKey) return apiKeysRepository;

      throw new Error('Unknown repository');
    });

    dataSource.transaction.mockImplementation(
      async (callback: (m: unknown) => unknown) => callback(manager),
    );

    ordersRepository.update.mockResolvedValue({ affected: 0 });
    ordersRepository.find.mockResolvedValue([]);
    ordersRepository.create.mockImplementation((data) => data);
    ordersRepository.save.mockImplementation(async (data) => data);

    usageLogsRepository.create.mockImplementation((data) => data);
    usageLogsRepository.save.mockImplementation(async (data) => data);

    apiKeysRepository.update.mockResolvedValue({ affected: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        {
          provide: getRepositoryToken(PaymentOrder),
          useValue: ordersRepository,
        },
        { provide: getRepositoryToken(ApiKey), useValue: apiKeysRepository },
        { provide: BusinessService, useValue: businessService },
        { provide: SubscriptionsService, useValue: subscriptionsService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);

    businessService.findById.mockResolvedValue({
      id: 'business-1',
      is_active: true,
      promptpay_id: '0812345678',
    });
    apiKeysRepository.findOne.mockResolvedValue({
      id: 'key-1',
      is_active: true,
    });
    subscriptionsService.assertQuotaAndRateLimit.mockResolvedValue({});
  });

  it('checks quota and rate limit before creating an order and logs QR_CREATED', async () => {
    const result = await service.createQrOrder(user, dto);

    expect(businessService.findById).toHaveBeenCalledWith('business-1');
    expect(
      subscriptionsService.assertQuotaAndRateLimit,
    ).toHaveBeenCalledWith('business-1', manager);
    expect(result).toMatchObject({
      base_amount: 100,
      decimal_ref: 0.01,
      total_amount: 100.01,
      status: 'UNVERIFIED',
      api_key_id: 'key-1',
    });
    expect(result.order_id).toEqual(expect.any(String));
    expect(ordersRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ api_key_id: 'key-1' }),
    );
    expect(usageLogsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        api_key_id: 'key-1',
        business_id: 'business-1',
        action: 'QR_CREATED',
        quota_deducted: false,
      }),
    );
  });

  it('allocates the next free decimal reference slot', async () => {
    ordersRepository.find.mockResolvedValue([{ decimal_ref: 0.01 }]);

    const result = await service.createQrOrder(user, dto);

    expect(result.decimal_ref).toBe(0.02);
    expect(result.total_amount).toBe(100.02);
  });

  it('propagates a 403 when the subscription is PAST_DUE', async () => {
    subscriptionsService.assertQuotaAndRateLimit.mockRejectedValue(
      new ForbiddenException('Business package is inactive or unpaid'),
    );

    await expect(service.createQrOrder(user, dto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(ordersRepository.save).not.toHaveBeenCalled();
  });

  it('rejects when the API key used for the token was deactivated', async () => {
    apiKeysRepository.findOne.mockResolvedValue(null);

    await expect(service.createQrOrder(user, dto)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('does not write usage logs when the request is not made with an API key', async () => {
    const result = await service.createQrOrder(
      { ...user, apiKeyId: null },
      dto,
    );

    expect(result.api_key_id).toBeNull();
    expect(usageLogsRepository.save).not.toHaveBeenCalled();
    expect(apiKeysRepository.update).not.toHaveBeenCalled();
  });

  it('rejects when the business account is not active', async () => {
    businessService.findById.mockResolvedValue({
      id: 'business-1',
      is_active: false,
    });

    await expect(service.createQrOrder(user, dto)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('resolves business via findByUserId when user.businessId is null and rejects when none exists', async () => {
    businessService.findByUserId.mockResolvedValueOnce(null);

    await expect(
      service.createQrOrder({ ...user, businessId: null }, dto),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws ConflictException when all 99 decimal reference slots are occupied', async () => {
    ordersRepository.find.mockResolvedValue(
      Array.from({ length: 99 }, (_, i) => ({
        decimal_ref: (i + 1) / 100,
      })),
    );

    await expect(service.createQrOrder(user, dto)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  describe('findOrderById & getOrderOrFail', () => {
    it('returns the order when found', async () => {
      const order = { id: 'ord-1' } as PaymentOrder;
      ordersRepository.findOne.mockResolvedValue(order);

      await expect(service.getOrderOrFail('ord-1')).resolves.toBe(order);
    });

    it('throws NotFoundException when order does not exist', async () => {
      ordersRepository.findOne.mockResolvedValue(null);

      await expect(service.getOrderOrFail('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
