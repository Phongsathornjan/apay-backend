import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKey } from '../api-keys/entities/api-key.entity';
import { ApiKeyUsageLog } from '../api-keys/entities/api-key-usage-log.entity';
import { Business } from '../business/entities/business.entity';
import { Package } from '../packages/entities/package.entity';
import { PaymentOrder } from '../payment/entities/payment-order.entity';
import { BusinessSubscription } from '../subscriptions/entities/business-subscription.entity';
import { SubscriptionPeriod } from '../subscriptions/entities/subscription-period.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { UsersModule } from '../users/users.module';
import { WebhookLog } from '../webhook/entities/webhook-log.entity';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentOrder,
      ApiKeyUsageLog,
      ApiKey,
      BusinessSubscription,
      SubscriptionPeriod,
      Package,
      Business,
      WebhookLog,
    ]),
    UsersModule,
    SubscriptionsModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
