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
}
