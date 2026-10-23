import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { AuthUser } from '../auth/types/auth-user.type';
import { RoleEnum } from '../enums';
import { DashboardService } from './dashboard.service';
import { AdminBusinessesQueryDto } from './dto/admin-businesses-query.dto';
import { DashboardApiKeysQueryDto } from './dto/dashboard-api-keys-query.dto';
import { DashboardExpiringQueryDto } from './dto/dashboard-expiring-query.dto';
import { DashboardRangeQueryDto } from './dto/dashboard-range-query.dto';
import { DashboardUsageQueryDto } from './dto/dashboard-usage-query.dto';

@Controller({
  path: 'dashboard',
  version: '1',
})
@UseGuards(JwtAuthGuard, RoleGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @Roles(RoleEnum.ADMIN, RoleEnum.BUSINESS)
  getOverview(
    @Req() request: Request & { user: AuthUser },
    @Query() query: DashboardRangeQueryDto,
  ) {
    return this.dashboardService.getOverview(request.user, query);
  }

  @Get('usage/timeseries')
  @Roles(RoleEnum.ADMIN, RoleEnum.BUSINESS)
  getUsageTimeseries(
    @Req() request: Request & { user: AuthUser },
    @Query() query: DashboardUsageQueryDto,
  ) {
    return this.dashboardService.getUsageTimeseries(request.user, query);
  }

  @Get('transactions/timeseries')
  @Roles(RoleEnum.ADMIN, RoleEnum.BUSINESS)
  getTransactionsTimeseries(
    @Req() request: Request & { user: AuthUser },
    @Query() query: DashboardRangeQueryDto,
  ) {
    return this.dashboardService.getTransactionsTimeseries(request.user, query);
  }

  @Get('rate-limit')
  @Roles(RoleEnum.ADMIN, RoleEnum.BUSINESS)
  getRateLimit(
    @Req() request: Request & { user: AuthUser },
    @Query() query: DashboardRangeQueryDto,
  ) {
    return this.dashboardService.getRateLimitStatus(request.user, query);
  }

  @Get('api-keys')
  @Roles(RoleEnum.ADMIN, RoleEnum.BUSINESS)
  getApiKeys(
    @Req() request: Request & { user: AuthUser },
    @Query() query: DashboardApiKeysQueryDto,
  ) {
    return this.dashboardService.getApiKeyBreakdown(request.user, query);
  }

  @Get('api-keys/timeseries')
  @Roles(RoleEnum.ADMIN, RoleEnum.BUSINESS)
  getApiKeysTimeseries(
    @Req() request: Request & { user: AuthUser },
    @Query() query: DashboardApiKeysQueryDto,
  ) {
    return this.dashboardService.getApiKeyTimeseries(request.user, query);
  }

  @Get('subscription')
  @Roles(RoleEnum.ADMIN, RoleEnum.BUSINESS)
  getSubscription(
    @Req() request: Request & { user: AuthUser },
    @Query() query: DashboardRangeQueryDto,
  ) {
    return this.dashboardService.getSubscriptionTrend(request.user, query);
  }

  @Get('admin/overview')
  @Roles(RoleEnum.ADMIN)
  getAdminOverview(@Query() query: DashboardRangeQueryDto) {
    return this.dashboardService.getAdminOverview(query);
  }

  @Get('admin/timeseries')
  @Roles(RoleEnum.ADMIN)
  getAdminTimeseries(@Query() query: DashboardRangeQueryDto) {
    return this.dashboardService.getAdminTimeseries(query);
  }

  @Get('admin/distribution')
  @Roles(RoleEnum.ADMIN)
  getAdminDistribution(@Query() query: DashboardRangeQueryDto) {
    return this.dashboardService.getAdminDistribution(query);
  }

  @Get('admin/businesses')
  @Roles(RoleEnum.ADMIN)
  getAdminBusinesses(@Query() query: AdminBusinessesQueryDto) {
    return this.dashboardService.getAdminBusinesses(query);
  }

  @Get('admin/expiring')
  @Roles(RoleEnum.ADMIN)
  getAdminExpiring(@Query() query: DashboardExpiringQueryDto) {
    return this.dashboardService.getAdminExpiring(query);
  }
}
