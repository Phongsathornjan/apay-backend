import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { RoleGuard } from '../auth/guards/role.guard';
import { AuthUser } from '../auth/types/auth-user.type';
import { UsersService } from '../users/users.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

describe('DashboardModule / Controller Guard wiring', () => {
  let controller: DashboardController;
  let roleGuard: RoleGuard;
  let dashboardService: Record<string, jest.Mock>;
  let usersService: { findById: jest.Mock };

  beforeEach(async () => {
    dashboardService = {
      getOverview: jest.fn().mockResolvedValue({ ok: true }),
      getUsageTimeseries: jest.fn().mockResolvedValue({ series: [] }),
      getTransactionsTimeseries: jest.fn().mockResolvedValue({ series: [] }),
      getRateLimitStatus: jest.fn().mockResolvedValue({ series: [] }),
      getApiKeyBreakdown: jest.fn().mockResolvedValue({ keys: [] }),
      getApiKeyTimeseries: jest.fn().mockResolvedValue({ series: [] }),
      getSubscriptionTrend: jest.fn().mockResolvedValue({ periods: [] }),
      getAdminOverview: jest.fn().mockResolvedValue({}),
      getAdminTimeseries: jest.fn().mockResolvedValue({ series: [] }),
      getAdminDistribution: jest.fn().mockResolvedValue({}),
      getAdminBusinesses: jest.fn().mockResolvedValue({ items: [] }),
      getAdminExpiring: jest.fn().mockResolvedValue({ expiring: [] }),
    };

    usersService = {
      findById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        RoleGuard,
        Reflector,
        { provide: DashboardService, useValue: dashboardService },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    controller = module.get<DashboardController>(DashboardController);
    roleGuard = module.get<RoleGuard>(RoleGuard);
  });

  it('resolves DashboardController and RoleGuard dependencies cleanly', () => {
    expect(controller).toBeDefined();
    expect(roleGuard).toBeDefined();
  });

  it('delegates business routes to DashboardService', async () => {
    const user: AuthUser = {
      userId: 'user-1',
      username: 'merchant',
      role: 'business',
      businessId: 'biz-1',
    };

    await controller.getOverview({ user } as any, {});
    expect(dashboardService.getOverview).toHaveBeenCalledWith(user, {});

    await controller.getUsageTimeseries({ user } as any, {});
    expect(dashboardService.getUsageTimeseries).toHaveBeenCalledWith(user, {});

    await controller.getTransactionsTimeseries({ user } as any, {});
    expect(dashboardService.getTransactionsTimeseries).toHaveBeenCalledWith(
      user,
      {},
    );

    await controller.getRateLimit({ user } as any, {});
    expect(dashboardService.getRateLimitStatus).toHaveBeenCalledWith(user, {});

    await controller.getApiKeys({ user } as any, {});
    expect(dashboardService.getApiKeyBreakdown).toHaveBeenCalledWith(user, {});

    await controller.getApiKeysTimeseries({ user } as any, {});
    expect(dashboardService.getApiKeyTimeseries).toHaveBeenCalledWith(user, {});

    await controller.getSubscription({ user } as any, {});
    expect(dashboardService.getSubscriptionTrend).toHaveBeenCalledWith(
      user,
      {},
    );
  });

  it('delegates admin routes to DashboardService', async () => {
    await controller.getAdminOverview({});
    expect(dashboardService.getAdminOverview).toHaveBeenCalledWith({});

    await controller.getAdminTimeseries({});
    expect(dashboardService.getAdminTimeseries).toHaveBeenCalledWith({});

    await controller.getAdminDistribution({});
    expect(dashboardService.getAdminDistribution).toHaveBeenCalledWith({});

    await controller.getAdminBusinesses({});
    expect(dashboardService.getAdminBusinesses).toHaveBeenCalledWith({});

    await controller.getAdminExpiring({});
    expect(dashboardService.getAdminExpiring).toHaveBeenCalledWith({});
  });

  it('blocks business users from calling admin-only routes via RoleGuard', async () => {
    usersService.findById.mockResolvedValue({
      id: 'user-1',
      is_active: true,
      role: { name: 'business' },
    });

    const context = {
      getHandler: () => DashboardController.prototype.getAdminOverview,
      getClass: () => DashboardController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            userId: 'user-1',
            username: 'merchant',
            role: 'business',
            businessId: 'biz-1',
          },
        }),
      }),
    } as unknown as ExecutionContext;

    await expect(roleGuard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
