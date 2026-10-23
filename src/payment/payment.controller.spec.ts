import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/types/auth-user.type';
import { PaymentOrderStatusEnum, RoleEnum } from '../enums';
import { UsersService } from '../users/users.service';
import { PaymentOrder } from './entities/payment-order.entity';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';

describe('PaymentController', () => {
  let controller: PaymentController;
  let paymentService: {
    createQrOrder: jest.Mock;
    getOrderOrFail: jest.Mock;
  };

  const businessUser: AuthUser = {
    userId: 'u1',
    username: 'merchant',
    role: RoleEnum.BUSINESS,
    businessId: 'biz-1',
  };

  const adminUser: AuthUser = {
    userId: 'admin-1',
    username: 'admin',
    role: RoleEnum.ADMIN,
    businessId: null,
  };

  const sampleOrder = {
    id: '20261020150000_100.01',
    lookup_key: '20261020_100.01',
    business_id: 'biz-1',
    base_amount: 100,
    decimal_ref: 0.01,
    total_amount: 100.01,
    qr_payload: '000201...',
    status: PaymentOrderStatusEnum.UNVERIFIED,
    callback_sent: false,
    callback_status_code: null,
    redirect_url: 'https://example.com/cb',
    expires_at: new Date('2026-10-20T08:05:00.000Z'),
    paid_at: null,
    created_at: new Date('2026-10-20T08:00:00.000Z'),
  } as PaymentOrder;

  beforeEach(async () => {
    paymentService = {
      createQrOrder: jest.fn(),
      getOrderOrFail: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [
        { provide: PaymentService, useValue: paymentService },
        { provide: UsersService, useValue: { findById: jest.fn() } },
      ],
    }).compile();

    controller = module.get<PaymentController>(PaymentController);
  });

  it('configures RoleEnum metadata on createQr and getOrder', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, PaymentController.prototype.createQr),
    ).toEqual([RoleEnum.BUSINESS, RoleEnum.ADMIN]);
    expect(
      Reflect.getMetadata(ROLES_KEY, PaymentController.prototype.getOrder),
    ).toEqual([RoleEnum.BUSINESS, RoleEnum.ADMIN]);
  });

  it('delegates createQr to PaymentService.createQrOrder', async () => {
    const dto = { amount: 100, redirect_url: 'https://example.com/cb' };
    paymentService.createQrOrder.mockResolvedValue({ order_id: 'ord-1' });

    const result = await controller.createQr(
      { user: businessUser } as any,
      dto,
    );

    expect(paymentService.createQrOrder).toHaveBeenCalledWith(
      businessUser,
      dto,
    );
    expect(result).toEqual({ order_id: 'ord-1' });
  });

  it('returns order details when business user owns the order', async () => {
    paymentService.getOrderOrFail.mockResolvedValue(sampleOrder);

    const result = await controller.getOrder(
      { user: businessUser } as any,
      sampleOrder.id,
    );

    expect(result).toMatchObject({
      order_id: sampleOrder.id,
      business_id: 'biz-1',
      status: PaymentOrderStatusEnum.UNVERIFIED,
    });
  });

  it('throws NotFoundException when business user requests another business order', async () => {
    paymentService.getOrderOrFail.mockResolvedValue({
      ...sampleOrder,
      business_id: 'biz-other',
    });

    await expect(
      controller.getOrder({ user: businessUser } as any, sampleOrder.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException when business user has null businessId', async () => {
    paymentService.getOrderOrFail.mockResolvedValue(sampleOrder);

    await expect(
      controller.getOrder(
        { user: { ...businessUser, businessId: null } } as any,
        sampleOrder.id,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows admin user to retrieve any business order', async () => {
    paymentService.getOrderOrFail.mockResolvedValue({
      ...sampleOrder,
      business_id: 'biz-other',
    });

    const result = await controller.getOrder(
      { user: adminUser } as any,
      sampleOrder.id,
    );

    expect(result.business_id).toBe('biz-other');
  });
});
