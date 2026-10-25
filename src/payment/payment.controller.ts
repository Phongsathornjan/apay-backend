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
import { RoleEnum } from '../enums';
import { CreateLinkQrDto } from './dto/create-link-qr.dto';
import { CreateQrDto } from './dto/create-qr.dto';
import { PaymentService } from './payment.service';

@Controller({
  path: 'payments',
  version: '1',
})
@UseGuards(JwtAuthGuard, RoleGuard)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('qr')
  @Roles(RoleEnum.BUSINESS, RoleEnum.ADMIN)
  createQr(
    @Req() request: Request & { user: AuthUser },
    @Body() dto: CreateQrDto,
  ) {
    return this.paymentService.createQrOrder(request.user, dto);
  }

  /**
   * สร้าง QR ยืนยัน (ยอด 0.01 - 0.99) เพื่อผูก LINE User ID เข้ากับ Business
   * ใช้ได้เฉพาะธุรกิจที่ยังไม่เคยผูก LINE เท่านั้น
   *
   * Body (optional): `{ redirect_url }` — เมื่อ QR นี้ถูกชำระ ระบบจะยิง
   * HTTP POST (event `line.linked`) ไปที่ `redirect_url` ทันที
   */
  @Post('line/link-qr')
  @Roles(RoleEnum.BUSINESS, RoleEnum.ADMIN)
  createLineLinkQr(
    @Req() request: Request & { user: AuthUser },
    @Body() dto: CreateLinkQrDto,
  ) {
    return this.paymentService.createLineLinkOrder(request.user, dto);
  }

  @Get('orders/:id')
  @Roles(RoleEnum.BUSINESS, RoleEnum.ADMIN)
  async getOrder(
    @Req() request: Request & { user: AuthUser },
    @Param('id') id: string,
  ) {
    const order = await this.paymentService.getOrderOrFail(id);

    if (
      request.user.role === RoleEnum.BUSINESS &&
      (!request.user.businessId || order.business_id !== request.user.businessId)
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
      line_user_id: order.line_user_id,
      is_line_link: order.is_line_link,
      expires_at: order.expires_at,
      paid_at: order.paid_at,
      created_at: order.created_at,
    };
  }
}
