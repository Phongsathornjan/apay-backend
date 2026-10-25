import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { UsersModule } from '../users/users.module';
import { BusinessService } from './business.service';
import { Business } from './entities/business.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Business]),
    UsersModule,
    SubscriptionsModule,
  ],
  providers: [BusinessService],
  exports: [BusinessService, TypeOrmModule],
})
export class BusinessModule {}
