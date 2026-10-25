import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Business } from '../business/entities/business.entity';
import { BusinessModule } from '../business/business.module';
import { MailModule } from '../mail/mail.module';
import { BusinessEmailOtp } from './entities/business-email-otp.entity';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BusinessEmailOtp, Business]),
    BusinessModule,
    MailModule,
  ],
  controllers: [RegistrationController],
  providers: [RegistrationService],
})
export class RegistrationModule {}
