import { IsString, Matches } from 'class-validator';
import { RegisterBusinessDto } from '../../auth/dto/register-business.dto';

/**
 * ข้อมูลสมัครธุรกิจด้วยตัวเอง = ข้อมูลเดียวกับ `RegisterBusinessDto`
 * (email ถูก normalize เป็นตัวพิมพ์เล็ก + trim แล้ว) บวก `otp` 6 หลัก
 */
export class VerifyBusinessOtpDto extends RegisterBusinessDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp must be a 6-digit code' })
  otp: string;
}
