import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { RequestBusinessOtpDto } from './dto/request-business-otp.dto';
import { VerifyBusinessOtpDto } from './dto/verify-business-otp.dto';
import { RegistrationService } from './registration.service';

/**
 * Public endpoints สำหรับสมัครบัญชีธุรกิจด้วยตัวเอง (ไม่ต้องใช้ JWT)
 * ต้องยืนยันอีเมลด้วย OTP ก่อนสร้างบัญชีเสมอ
 */
@Controller({
  path: 'auth/register-business',
  version: '1',
})
export class RegistrationController {
  constructor(private readonly registrationService: RegistrationService) {}

  @Post('request-otp')
  @HttpCode(HttpStatus.OK)
  requestOtp(@Body() dto: RequestBusinessOtpDto) {
    return this.registrationService.requestOtp(dto);
  }

  @Post('verify-otp')
  verifyOtp(@Body() dto: VerifyBusinessOtpDto) {
    return this.registrationService.verifyOtpAndRegister(dto);
  }
}
