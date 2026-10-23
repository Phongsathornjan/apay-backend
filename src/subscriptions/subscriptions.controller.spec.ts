import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/types/auth-user.type';
import { RoleEnum } from '../enums';
import { UsersService } from '../users/users.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

describe('SubscriptionsController', () => {
  let controller: SubscriptionsController;
  let subscriptionsService: {
    assignOrChangePackage: jest.Mock;
    renewSubscription: jest.Mock;
    getBusinessSubscriptionDetails: jest.Mock;
    getBusinessUsage: jest.Mock;
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

  beforeEach(async () => {
    subscriptionsService = {
      assignOrChangePackage: jest.fn(),
      renewSubscription: jest.fn(),
      getBusinessSubscriptionDetails: jest.fn(),
      getBusinessUsage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionsController],
      providers: [
        { provide: SubscriptionsService, useValue: subscriptionsService },
        { provide: UsersService, useValue: { findById: jest.fn() } },
      ],
    }).compile();

    controller = module.get<SubscriptionsController>(SubscriptionsController);
  });

  it('configures RoleEnum metadata on routes', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        SubscriptionsController.prototype.assignOrChange,
      ),
    ).toEqual([RoleEnum.ADMIN]);
    expect(
      Reflect.getMetadata(ROLES_KEY, SubscriptionsController.prototype.renew),
    ).toEqual([RoleEnum.ADMIN]);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        SubscriptionsController.prototype.getBusiness,
      ),
    ).toEqual([RoleEnum.ADMIN, RoleEnum.BUSINESS]);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        SubscriptionsController.prototype.getBusinessUsage,
      ),
    ).toEqual([RoleEnum.ADMIN, RoleEnum.BUSINESS]);
  });

  it('delegates assignOrChange and renew to SubscriptionsService', async () => {
    await controller.assignOrChange({
      business_id: 'biz-1',
      package_id: 'pkg-1',
    });
    expect(subscriptionsService.assignOrChangePackage).toHaveBeenCalledWith(
      'biz-1',
      'pkg-1',
    );

    await controller.renew('sub-1', { package_id: 'pkg-2' });
    expect(subscriptionsService.renewSubscription).toHaveBeenCalledWith(
      'sub-1',
      'pkg-2',
    );
  });

  it('allows business users to view their own subscription and usage', async () => {
    await controller.getBusiness({ user: businessUser } as any, 'biz-1');
    expect(
      subscriptionsService.getBusinessSubscriptionDetails,
    ).toHaveBeenCalledWith('biz-1');

    await controller.getBusinessUsage({ user: businessUser } as any, 'biz-1');
    expect(subscriptionsService.getBusinessUsage).toHaveBeenCalledWith('biz-1');
  });

  it('throws NotFoundException when business user requests another business subscription or usage', () => {
    expect(() =>
      controller.getBusiness({ user: businessUser } as any, 'biz-other'),
    ).toThrow(NotFoundException);

    expect(() =>
      controller.getBusinessUsage({ user: businessUser } as any, 'biz-other'),
    ).toThrow(NotFoundException);
  });

  it('allows admin users to view any business subscription and usage', async () => {
    await controller.getBusiness({ user: adminUser } as any, 'biz-other');
    expect(
      subscriptionsService.getBusinessSubscriptionDetails,
    ).toHaveBeenCalledWith('biz-other');
  });
});
