import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions } from 'typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AuthModule } from './auth/auth.module';
import { BusinessModule } from './business/business.module';
import { DatabaseModule } from './database/database.module';
import { DB_SCHEMA } from './database/database.schema';
import { DashboardModule } from './dashboard/dashboard.module';
import { PackagesModule } from './packages/packages.module';
import { PaymentModule } from './payment/payment.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { UsersModule } from './users/users.module';
import { WebhookModule } from './webhook/webhook.module';
import { ResponseInterceptor } from './common/interceptor/response.interceptor';
import { LoggerInterceptor } from './common/interceptor/logger.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres' as const,
        url: configService.get<string>('DATABASE_URL'),
        schema: DB_SCHEMA,
        autoLoadEntities: true,
        synchronize: configService.get<string>('ENV') === 'development',
      }),
      dataSourceFactory: async (options?: DataSourceOptions) => {
        if (!options) {
          throw new Error('TypeORM data source options are not provided');
        }

        // สร้าง schema (ถ้ายังไม่มี) ก่อนที่ TypeORM จะรัน synchronize
        const bootstrapDataSource = new DataSource({
          ...options,
          entities: [],
          synchronize: false,
        });

        await bootstrapDataSource.initialize();

        try {
          await bootstrapDataSource.query(
            `CREATE SCHEMA IF NOT EXISTS "${DB_SCHEMA}"`,
          );
        } finally {
          await bootstrapDataSource.destroy();
        }

        return new DataSource(options);
      },
    }),
    AuthModule,
    UsersModule,
    BusinessModule,
    PackagesModule,
    SubscriptionsModule,
    ApiKeysModule,
    PaymentModule,
    WebhookModule,
    DashboardModule,
    DatabaseModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggerInterceptor,
    },
  ],
})
export class AppModule {}
