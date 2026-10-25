import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * ข้อมูลสำหรับ `POST /api/v1/auth/register-business/verify-otp`:
 * ข้อมูลธุรกิจ/บัญชีครบชุด (ใช้สร้าง `User` + `Business` ทันทีเมื่อ OTP ถูกต้อง)
 * บวก `otp` 6 หลักที่ส่งไปยังอีเมล
 *
 * ฟิลด์ธุรกิจชุดเดียวกับ `RegisterBusinessDto` ของ `POST /auth/register-business`
 * (ประกาศไว้ที่ไฟล์นี้โดยตรงเพื่อให้เห็น contract ของ endpoint นี้ชัดเจน —
 * มี unit test คุมไม่ให้ validation หลุดจากกัน)
 */
export class VerifyBusinessOtpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  business_name: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @Matches(/^(\d{10}|\d{13})$/, {
    message: 'promptpay_id must be a 10-digit phone number or 13-digit id',
  })
  promptpay_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  line_destination?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  line_user_id?: string;

  @IsOptional()
  @IsUUID()
  package_id?: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp must be a 6-digit code' })
  otp: string;
}
