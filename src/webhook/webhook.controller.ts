import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import type { IosNotificationBody } from './types/ios-notification.type';
import { WebhookService } from './webhook.service';

@Controller({
  path: 'webhooks',
  version: '1',
})
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  /**
   * รับแจ้งเตือนเงินเข้าจากแอปธนาคาร (ทุกธนาคารใช้ path เดียวกัน) ที่ส่งต่อผ่าน iOS Shortcut
   * Body: `{ app: 'K_PLUS', title: 'รายการเงินเข้า', body: '...' }`
   *
   * - เลือก parser ตามฟิลด์ `app` (ตอนนี้รองรับเฉพาะ `K_PLUS` = KBank)
   * - ธนาคารที่ยังไม่รองรับ (หรือไม่ส่ง `app`) → ตอบ `400 Unsupported bank app`
   *
   * ถ้าตั้ง Env `IOS_WEBHOOK_SECRET` (หรือ `KBANK_IOS_WEBHOOK_SECRET` ชื่อเดิม)
   * ต้องส่ง Header `x-webhook-secret` ให้ตรงด้วย
   */
  @Post('ios-notify')
  @HttpCode(HttpStatus.OK)
  handleIosNotification(
    @Body() body: IosNotificationBody,
    @Headers('x-webhook-secret') secret?: string,
  ) {
    const isValid = this.webhookService.verifyIosNotificationSecret(secret);

    if (!isValid) {
      throw new UnauthorizedException('Invalid webhook secret');
    }

    return this.webhookService.handleIosNotification(body);
  }
}
