import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import type { KbankIosNotificationBody } from './types/kbank-ios-notification.type';
import { WebhookService } from './webhook.service';

@Controller({
  path: 'webhooks',
  version: '1',
})
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

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
