import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { AuthUser } from '../auth/types/auth-user.type';
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
  @Roles('admin', 'business')
  getOverview(
    @Req() request: Request & { user: AuthUser },
    @Query() query: DashboardRangeQueryDto,
  ) {
    return this.dashboardService.getOverview(request.user, query);
  }

  @Get('usage/timeseries')
  @Roles('admin', 'business')
  getUsageTimeseries(
    @Req() request: Request & { user: AuthUser },
    @Query() query: DashboardUsageQueryDto,
  ) {
    return this.dashboardService.getUsageTimeseries(request.user, query);
  }

  @Get('transactions/timeseries')
  @Roles('admin', 'business')
  getTransactionsTimeseries(
    @Req() request: Request & { user: AuthUser },
    @Query() query: DashboardRangeQueryDto,
  ) {
    return this.dashboardService.getTransactionsTimeseries(request.user, query);
  }

  @Get('rate-limit')
  @Roles('admin', 'business')
  getRateLimit(
    @Req() request: Request & { user: AuthUser },
    @Query() query: DashboardRangeQueryDto,
  ) {
    return this.dashboardService.getRateLimitStatus(request.user, query);
  }

  @Get('api-keys')
  @Roles('admin', 'business')
  getApiKeys(
    @Req() request: Request & { user: AuthUser },
    @Query() query: DashboardApiKeysQueryDto,
  ) {
    return this.dashboardService.getApiKeyBreakdown(request.user, query);
  }

  @Get('api-keys/timeseries')
  @Roles('admin', 'business')
  getApiKeysTimeseries(
    @Req() request: Request & { user: AuthUser },
    @Query() query: DashboardApiKeysQueryDto,
  ) {
    return this.dashboardService.getApiKeyTimeseries(request.user, query);
  }

  @Get('subscription')
  @Roles('admin', 'business')
  getSubscription(
    @Req() request: Request & { user: AuthUser },
    @Query() query: DashboardRangeQueryDto,
  ) {
    return this.dashboardService.getSubscriptionTrend(request.user, query);
  }

  @Get('admin/overview')
  @Roles('admin')
  getAdminOverview(@Query() query: DashboardRangeQueryDto) {
    return this.dashboardService.getAdminOverview(query);
  }

  @Get('admin/timeseries')
  @Roles('admin')
  getAdminTimeseries(@Query() query: DashboardRangeQueryDto) {
    return this.dashboardService.getAdminTimeseries(query);
  }

  @Get('admin/distribution')
  @Roles('admin')
  getAdminDistribution(@Query() query: DashboardRangeQueryDto) {
    return this.dashboardService.getAdminDistribution(query);
  }

  @Get('admin/businesses')
  @Roles('admin')
  getAdminBusinesses(@Query() query: AdminBusinessesQueryDto) {
    return this.dashboardService.getAdminBusinesses(query);
  }

  @Get('admin/expiring')
  @Roles('admin')
  getAdminExpiring(@Query() query: DashboardExpiringQueryDto) {
    return this.dashboardService.getAdminExpiring(query);
  }
}
