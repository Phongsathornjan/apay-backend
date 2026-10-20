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
  @Roles('admin')
  assignOrChange(@Body() dto: AssignSubscriptionDto) {
    return this.subscriptionsService.assignOrChangePackage(
      dto.business_id,
      dto.package_id,
    );
  }

  @Post(':id/renew')
  @Roles('admin')
  renew(
    @Param('id') id: string,
    @Body() dto: RenewSubscriptionDto,
  ) {
    return this.subscriptionsService.renewSubscription(id, dto.package_id);
  }

  @Get('business/:businessId')
  @Roles('admin', 'business')
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
  @Roles('admin', 'business')
  getBusinessUsage(
    @Req() request: Request & { user: AuthUser },
    @Param('businessId') businessId: string,
  ) {
    this.assertBusinessAccess(request.user, businessId);

    return this.subscriptionsService.getBusinessUsage(businessId);
  }

  private assertBusinessAccess(user: AuthUser, businessId: string): void {
    if (user.role === 'business' && user.businessId !== businessId) {
      throw new NotFoundException('Business subscription not found');
    }
  }
}
