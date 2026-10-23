import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { AuthUser } from '../auth/types/auth-user.type';
import { RoleEnum } from '../enums';
import { AssignSubscriptionDto } from './dto/assign-subscription.dto';
import { RenewSubscriptionDto } from './dto/renew-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@Controller({
  path: 'subscriptions',
  version: '1',
})
@UseGuards(JwtAuthGuard, RoleGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post()
  @Roles(RoleEnum.ADMIN)
  assignOrChange(@Body() dto: AssignSubscriptionDto) {
    return this.subscriptionsService.assignOrChangePackage(
      dto.business_id,
      dto.package_id,
    );
  }

  @Post(':id/renew')
  @Roles(RoleEnum.ADMIN)
  renew(
    @Param('id') id: string,
    @Body() dto: RenewSubscriptionDto,
  ) {
    return this.subscriptionsService.renewSubscription(id, dto.package_id);
  }

  @Get('business/:businessId')
  @Roles(RoleEnum.ADMIN, RoleEnum.BUSINESS)
  getBusiness(
    @Req() request: Request & { user: AuthUser },
    @Param('businessId') businessId: string,
  ) {
    this.assertBusinessAccess(request.user, businessId);

    return this.subscriptionsService.getBusinessSubscriptionDetails(
      businessId,
    );
  }

  @Get('business/:businessId/usage')
  @Roles(RoleEnum.ADMIN, RoleEnum.BUSINESS)
  getBusinessUsage(
    @Req() request: Request & { user: AuthUser },
    @Param('businessId') businessId: string,
  ) {
    this.assertBusinessAccess(request.user, businessId);

    return this.subscriptionsService.getBusinessUsage(businessId);
  }

  private assertBusinessAccess(user: AuthUser, businessId: string): void {
    if (
      user.role === RoleEnum.BUSINESS &&
      (!user.businessId || user.businessId !== businessId)
    ) {
      throw new NotFoundException('Business subscription not found');
    }
  }
}
