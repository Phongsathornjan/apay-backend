import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from '../business/entities/business.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { UsersModule } from '../users/users.module';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyUsageLog } from './entities/api-key-usage-log.entity';
import { ApiKey } from './entities/api-key.entity';
import { BusinessModule } from '../business/business.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApiKey, ApiKeyUsageLog, Business]),
    SubscriptionsModule,
    UsersModule,
    BusinessModule
  ],
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
  exports: [ApiKeysService, TypeOrmModule],
})
export class ApiKeysModule {}
