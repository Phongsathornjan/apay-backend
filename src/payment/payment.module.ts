import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeyUsageLog } from '../api-keys/entities/api-key-usage-log.entity';
import { ApiKey } from '../api-keys/entities/api-key.entity';
import { AuthModule } from '../auth/auth.module';
import { BusinessModule } from '../business/business.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PaymentOrder } from './entities/payment-order.entity';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentOrder, ApiKey, ApiKeyUsageLog]),
    AuthModule,
    BusinessModule,
    SubscriptionsModule,
  ],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService, TypeOrmModule],
})
export class PaymentModule {}
