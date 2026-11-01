import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import type { KbankIosNotificationBody } from './types/kbank-ios-notification.type';
import type { LineWebhookBody } from './types/line-webhook.type';
import { WebhookService } from './webhook.service';

@Controller({
  path: 'webhooks',
  version: '1',
})
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post('kbank/line')
  @HttpCode(HttpStatus.OK)
  handleKbankLineWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Body() body: LineWebhookBody,
    @Headers('x-line-signature') signature?: string,
  ) {
    const isValid = this.webhookService.verifySignature(
      request.rawBody,
      signature,
    );

    if (!isValid) {
      throw new UnauthorizedException('Invalid LINE signature');
    }

    return this.webhookService.handleWebhook(body);
  }

  /**
   * รับแจ้งเตือนเงินเข้าจากแอป KBank (K PLUS) ที่ส่งต่อผ่าน iOS Shortcut
   * Body: `{ app: 'K_PLUS', title: 'รายการเงินเข้า', body: '...' }`
   *
   * ถ้าตั้ง Env `KBANK_IOS_WEBHOOK_SECRET` ต้องส่ง Header `x-webhook-secret` ให้ตรงด้วย
   */
  @Post('kbank/ios-notify')
  @HttpCode(HttpStatus.OK)
  handleKbankIosNotification(
    @Body() body: KbankIosNotificationBody,
    @Headers('x-webhook-secret') secret?: string,
  ) {
    const isValid = this.webhookService.verifyIosNotificationSecret(secret);

    if (!isValid) {
      throw new UnauthorizedException('Invalid webhook secret');
    }

    return this.webhookService.handleIosNotification(body);
  }
}
