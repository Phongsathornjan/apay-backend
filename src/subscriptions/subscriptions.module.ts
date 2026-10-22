import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKey } from '../api-keys/entities/api-key.entity';
import { ApiKeyUsageLog } from '../api-keys/entities/api-key-usage-log.entity';
import { Business } from '../business/entities/business.entity';
import { Package } from '../packages/entities/package.entity';
import { UsersModule } from '../users/users.module';
import { BusinessSubscription } from './entities/business-subscription.entity';
import { SubscriptionPeriod } from './entities/subscription-period.entity';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BusinessSubscription,
      SubscriptionPeriod,
      Package,
      Business,
      ApiKey,
      ApiKeyUsageLog,
    ]),
    UsersModule,
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService, TypeOrmModule],
})
export class SubscriptionsModule {}
