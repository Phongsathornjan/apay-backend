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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../auth/types/auth-user.type';
import { CreateQrDto } from './dto/create-qr.dto';
import { PaymentService } from './payment.service';

@Controller({
  path: 'payments',
  version: '1',
})
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('qr')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('business', 'admin')
  createQr(
    @Req() request: Request & { user: AuthUser },
    @Body() dto: CreateQrDto,
  ) {
    return this.paymentService.createQrOrder(request.user, dto);
  }

  @Get('orders/:id')
  @UseGuards(JwtAuthGuard)
  async getOrder(
    @Req() request: Request & { user: AuthUser },
    @Param('id') id: string,
  ) {
    const order = await this.paymentService.getOrderOrFail(id);

    if (
      request.user.role === 'business' &&
      request.user.businessId &&
      order.business_id !== request.user.businessId
    ) {
      throw new NotFoundException('Payment order not found');
    }

    return {
      order_id: order.id,
      lookup_key: order.lookup_key,
      business_id: order.business_id,
      base_amount: order.base_amount,
      decimal_ref: order.decimal_ref,
      total_amount: order.total_amount,
      qr_payload: order.qr_payload,
      status: order.status,
      callback_sent: order.callback_sent,
      callback_status_code: order.callback_status_code,
      redirect_url: order.redirect_url,
      expires_at: order.expires_at,
      paid_at: order.paid_at,
      created_at: order.created_at,
    };
  }
}
