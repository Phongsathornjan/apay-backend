import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessSubscription } from '../subscriptions/entities/business-subscription.entity';
import { UsersModule } from '../users/users.module';
import { Package } from './entities/package.entity';
import { PackagesController } from './packages.controller';
import { PackagesService } from './packages.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Package, BusinessSubscription]),
    UsersModule,
  ],
  controllers: [PackagesController],
  providers: [PackagesService],
  exports: [PackagesService, TypeOrmModule],
})
export class PackagesModule {}
