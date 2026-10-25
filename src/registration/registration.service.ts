import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'node:crypto';
import { IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { Business } from '../business/entities/business.entity';
import { safeCompare, sha256 } from '../common/utils/crypto.util';
import { MailService } from '../mail/mail.service';
import { RequestBusinessOtpDto } from './dto/request-business-otp.dto';
import { VerifyBusinessOtpDto } from './dto/verify-business-otp.dto';
import { BusinessEmailOtp } from './entities/business-email-otp.entity';

const DEFAULT_OTP_TTL_MINUTES = 10;
const DEFAULT_OTP_MAX_ATTEMPTS = 5;
const DEFAULT_OTP_RESEND_COOLDOWN_SECONDS = 60;
const DEFAULT_OTP_MAX_REQUESTS_PER_HOUR = 5;
const OTP_CLEANUP_AGE_DAYS = 7;
const OTP_CODE_LENGTH = 6;

export interface RequestOtpResult {
  email: string;
  expires_in: number;
  resend_available_in: number;
}

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    @InjectRepository(BusinessEmailOtp)
    private readonly otpRepository: Repository<BusinessEmailOtp>,
    @InjectRepository(Business)
    private readonly businessesRepository: Repository<Business>,
    private readonly authService: AuthService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * ขอ OTP ทางอีเมลสำหรับสมัครธุรกิจด้วยตัวเอง
   * - อีเมลที่ผูกกับธุรกิจแล้วจะถูกปฏิเสธ (409)
   * - จำกัดการขอซ้ำ (cooldown) และจำนวนครั้งต่อชั่วโมง (429)
   * - เก็บเฉพาะ SHA-256 hash ของรหัส พร้อมเวลาหมดอายุ
   */
  async requestOtp(dto: RequestBusinessOtpDto): Promise<RequestOtpResult> {
    const email = dto.email;
    const ttlMinutes = this.getNumberConfig(
      'OTP_TTL_MINUTES',
      DEFAULT_OTP_TTL_MINUTES,
    );
    const cooldownSeconds = this.getNumberConfig(
      'OTP_RESEND_COOLDOWN_SECONDS',
      DEFAULT_OTP_RESEND_COOLDOWN_SECONDS,
      0,
    );
    const maxRequestsPerHour = this.getNumberConfig(
      'OTP_MAX_REQUESTS_PER_HOUR',
      DEFAULT_OTP_MAX_REQUESTS_PER_HOUR,
    );

    const existingBusiness = await this.businessesRepository.findOne({
      where: { email },
    });

    if (existingBusiness) {
      throw new ConflictException('Email is already registered');
    }

    const now = new Date();
    const latestOtp = await this.otpRepository.findOne({
      where: { email },
      order: { created_at: 'DESC' },
    });

    if (latestOtp && cooldownSeconds > 0) {
      const elapsedMs = now.getTime() - latestOtp.created_at.getTime();
      const remainingMs = cooldownSeconds * 1000 - elapsedMs;

      if (remainingMs > 0) {
        const remainingSeconds = Math.ceil(remainingMs / 1000);

        throw new HttpException(
          `Please wait ${remainingSeconds} seconds before requesting a new OTP`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const requestedLastHour = await this.otpRepository.count({
      where: {
        email,
        created_at: MoreThan(new Date(now.getTime() - 60 * 60 * 1000)),
      },
    });

    if (requestedLastHour >= maxRequestsPerHour) {
      throw new HttpException(
        'Too many OTP requests; please try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = randomInt(0, 10 ** OTP_CODE_LENGTH)
      .toString()
      .padStart(OTP_CODE_LENGTH, '0');

    // ส่งอีเมลก่อนบันทึก: หากส่งไม่สำเร็จจะไม่ทิ้ง OTP ที่ใช้ไม่ได้ไว้ในระบบ
    await this.mailService.sendBusinessOtpEmail({
      to: email,
      code,
      expiresInMinutes: ttlMinutes,
    });

    await this.otpRepository.update(
      { email, consumed_at: IsNull() },
      { consumed_at: now },
    );

    const otp = this.otpRepository.create({
      email,
      otp_hash: sha256(code),
      attempts: 0,
      expires_at: new Date(now.getTime() + ttlMinutes * 60 * 1000),
      consumed_at: null,
    });

    await this.otpRepository.save(otp);

    this.logger.log(`Issued business registration OTP for ${email}`);

    return {
      email,
      expires_in: ttlMinutes * 60,
      resend_available_in: cooldownSeconds,
    };
  }

  /**
   * ตรวจ OTP แล้วสร้างบัญชีธุรกิจ (User + Business) ผ่าน `AuthService.registerBusiness`
   * - OTP ต้องไม่หมดอายุ ยังไม่ถูกใช้ และพยายามผิดไม่เกินกำหนด
   * - OTP จะถูกทำเครื่องหมายว่าถูกใช้ (`consumed_at`) หลังสมัครสำเร็จเท่านั้น
   *   เพื่อให้แก้ข้อมูลที่ผิด (เช่น username ซ้ำ) แล้วลองใหม่ได้ภายในเวลาที่ยังไม่หมดอายุ
   */
  async verifyOtpAndRegister(dto: VerifyBusinessOtpDto) {
    const maxAttempts = this.getNumberConfig(
      'OTP_MAX_ATTEMPTS',
      DEFAULT_OTP_MAX_ATTEMPTS,
    );

    const otp = await this.otpRepository.findOne({
      where: { email: dto.email, consumed_at: IsNull() },
      order: { created_at: 'DESC' },
    });

    if (!otp || otp.expires_at.getTime() <= Date.now()) {
      throw new BadRequestException('OTP is invalid or has expired');
    }

    if (otp.attempts >= maxAttempts) {
      throw new HttpException(
        'Too many OTP attempts; please request a new code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!safeCompare(sha256(dto.otp), otp.otp_hash)) {
      await this.otpRepository.increment({ id: otp.id }, 'attempts', 1);

      throw new BadRequestException('OTP is invalid or has expired');
    }

    const existingBusiness = await this.businessesRepository.findOne({
      where: { email: dto.email },
    });

    if (existingBusiness) {
      throw new ConflictException('Email is already registered');
    }

    const result = await this.authService.registerBusiness({
      username: dto.username,
      password: dto.password,
      business_name: dto.business_name,
      email: dto.email,
      promptpay_id: dto.promptpay_id,
      line_destination: dto.line_destination,
      line_user_id: dto.line_user_id,
      package_id: dto.package_id,
    });

    await this.otpRepository.update(
      { id: otp.id },
      { consumed_at: new Date() },
    );

    this.logger.log(`Business account verified and created for ${dto.email}`);

    return result;
  }

  /**
   * ลบ OTP เก่าที่หมดอายุแล้วเกิน 7 วัน เพื่อไม่ให้ตารางโตขึ้นเรื่อยๆ
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredOtps(): Promise<number> {
    const cutoff = new Date(
      Date.now() - OTP_CLEANUP_AGE_DAYS * 24 * 60 * 60 * 1000,
    );
    const result = await this.otpRepository.delete({
      created_at: LessThan(cutoff),
    });

    return result.affected ?? 0;
  }

  private getNumberConfig(key: string, fallback: number, min = 1): number {
    const raw = this.configService.get<string>(key);

    if (raw === undefined || raw === null || raw.trim() === '') {
      return fallback;
    }

    const parsed = Number(raw);

    return Number.isFinite(parsed) && parsed >= min
      ? Math.floor(parsed)
      : fallback;
  }
}
