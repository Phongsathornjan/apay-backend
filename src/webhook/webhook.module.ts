import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeyUsageLog } from '../api-keys/entities/api-key-usage-log.entity';
import { PaymentOrder } from '../payment/entities/payment-order.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { WebhookLog } from './entities/webhook-log.entity';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookLog, PaymentOrder, ApiKeyUsageLog]),
    HttpModule.register({ timeout: 5000, maxRedirects: 3 }),
    SubscriptionsModule,
  ],
  controllers: [WebhookController],
  providers: [WebhookService],
  exports: [WebhookService, TypeOrmModule],
})
export class WebhookModule {}
