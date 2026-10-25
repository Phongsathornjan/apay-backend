import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BusinessService } from '../business/business.service';
import { Business } from '../business/entities/business.entity';
import { sha256 } from '../common/utils/crypto.util';
import { MailService } from '../mail/mail.service';
import { BusinessEmailOtp } from './entities/business-email-otp.entity';
import { RegistrationService } from './registration.service';

const REGISTER_PAYLOAD = {
  email: 'owner@example.com',
  otp: '123456',
  username: 'merchant',
  password: 'StrongPass123!',
  business_name: 'Coffee Shop',
  promptpay_id: '0812345678',
};

describe('RegistrationService', () => {
  let service: RegistrationService;

  const otpRepository = {
    findOne: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    create: jest.fn((data: Partial<BusinessEmailOtp>) => data),
    save: jest.fn(),
    increment: jest.fn(),
    delete: jest.fn(),
  };

  const businessesRepository = {
    findOne: jest.fn(),
  };

  const businessService = {
    registerBusiness: jest.fn(),
  };

  const mailService = {
    sendBusinessOtpEmail: jest.fn(),
  };

  const configService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    businessesRepository.findOne.mockResolvedValue(null);
    otpRepository.findOne.mockResolvedValue(null);
    otpRepository.count.mockResolvedValue(0);
    otpRepository.update.mockResolvedValue({ affected: 1 });
    otpRepository.save.mockImplementation(
      async (data: Partial<BusinessEmailOtp>) => ({ id: 'otp-1', ...data }),
    );
    mailService.sendBusinessOtpEmail.mockResolvedValue(undefined);
    configService.get.mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegistrationService,
        {
          provide: getRepositoryToken(BusinessEmailOtp),
          useValue: otpRepository,
        },
        { provide: getRepositoryToken(Business), useValue: businessesRepository },
        { provide: BusinessService, useValue: businessService },
        { provide: MailService, useValue: mailService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<RegistrationService>(RegistrationService);
  });

  describe('requestOtp', () => {
    it('issues a 6-digit OTP by email and stores only its hash', async () => {
      const result = await service.requestOtp({ email: 'owner@example.com' });

      const sentCode = mailService.sendBusinessOtpEmail.mock.calls[0][0].code;

      expect(sentCode).toMatch(/^\d{6}$/);
      expect(mailService.sendBusinessOtpEmail).toHaveBeenCalledWith({
        to: 'owner@example.com',
        code: sentCode,
        expiresInMinutes: 10,
      });
      expect(otpRepository.update).toHaveBeenCalledWith(
        { email: 'owner@example.com', consumed_at: expect.anything() },
        { consumed_at: expect.any(Date) },
      );
      expect(otpRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'owner@example.com',
          otp_hash: sha256(sentCode),
          attempts: 0,
          consumed_at: null,
        }),
      );
      expect(result).toEqual({
        email: 'owner@example.com',
        expires_in: 600,
        resend_available_in: 60,
      });
    });

    it('respects the OTP_TTL_MINUTES override from config', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'OTP_TTL_MINUTES' ? '5' : undefined,
      );

      const result = await service.requestOtp({ email: 'owner@example.com' });

      expect(mailService.sendBusinessOtpEmail).toHaveBeenCalledWith(
        expect.objectContaining({ expiresInMinutes: 5 }),
      );
      expect(result.expires_in).toBe(300);
    });

    it('rejects an email that is already registered', async () => {
      businessesRepository.findOne.mockResolvedValue({ id: 'business-1' });

      await expect(
        service.requestOtp({ email: 'owner@example.com' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mailService.sendBusinessOtpEmail).not.toHaveBeenCalled();
    });

    it('enforces the resend cooldown with 429', async () => {
      otpRepository.findOne.mockResolvedValue({
        id: 'otp-old',
        created_at: new Date(Date.now() - 10_000),
      });

      const error = await service
        .requestOtp({ email: 'owner@example.com' })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect(mailService.sendBusinessOtpEmail).not.toHaveBeenCalled();
    });

    it('allows a new OTP once the cooldown has elapsed', async () => {
      otpRepository.findOne.mockResolvedValue({
        id: 'otp-old',
        created_at: new Date(Date.now() - 61_000),
      });

      await expect(
        service.requestOtp({ email: 'owner@example.com' }),
      ).resolves.toMatchObject({ email: 'owner@example.com' });
      expect(mailService.sendBusinessOtpEmail).toHaveBeenCalledTimes(1);
    });

    it('caps the number of OTP requests per hour with 429', async () => {
      otpRepository.count.mockResolvedValue(5);

      const error = await service
        .requestOtp({ email: 'owner@example.com' })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect(mailService.sendBusinessOtpEmail).not.toHaveBeenCalled();
    });

    it('does not persist an OTP when sending the email fails', async () => {
      mailService.sendBusinessOtpEmail.mockRejectedValueOnce(
        new Error('smtp down'),
      );

      await expect(
        service.requestOtp({ email: 'owner@example.com' }),
      ).rejects.toBeInstanceOf(Error);
      expect(otpRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtpAndRegister', () => {
    const validOtp = {
      id: 'otp-1',
      otp_hash: sha256('123456'),
      attempts: 0,
      expires_at: new Date(Date.now() + 60_000),
      consumed_at: null,
      created_at: new Date(),
    };

    it('verifies the OTP, creates the business and consumes the OTP', async () => {
      otpRepository.findOne.mockResolvedValue(validOtp);
      businessService.registerBusiness.mockResolvedValue({
        business_id: 'business-1',
      });

      const result = await service.verifyOtpAndRegister(REGISTER_PAYLOAD);

      const registerArgs = businessService.registerBusiness.mock.calls[0][0];

      expect(registerArgs).toMatchObject({
        username: 'merchant',
        email: 'owner@example.com',
        business_name: 'Coffee Shop',
      });
      expect(registerArgs).not.toHaveProperty('otp');
      expect(otpRepository.update).toHaveBeenCalledWith(
        { id: 'otp-1' },
        { consumed_at: expect.any(Date) },
      );
      expect(result).toEqual({ business_id: 'business-1' });
    });

    it('forwards every business field from the DTO and drops the otp', async () => {
      otpRepository.findOne.mockResolvedValue(validOtp);
      businessService.registerBusiness.mockResolvedValue({
        business_id: 'business-1',
      });

      await service.verifyOtpAndRegister({
        ...REGISTER_PAYLOAD,
        line_destination: 'U-destination',
        line_user_id: 'U-owner',
        package_id: '0f8fad5b-d9cb-469f-a165-70867728950e',
      });

      expect(businessService.registerBusiness).toHaveBeenCalledWith({
        username: 'merchant',
        password: 'StrongPass123!',
        business_name: 'Coffee Shop',
        email: 'owner@example.com',
        promptpay_id: '0812345678',
        line_destination: 'U-destination',
        line_user_id: 'U-owner',
        package_id: '0f8fad5b-d9cb-469f-a165-70867728950e',
      });
    });

    it('rejects when there is no active OTP', async () => {
      otpRepository.findOne.mockResolvedValue(null);

      await expect(
        service.verifyOtpAndRegister(REGISTER_PAYLOAD),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(businessService.registerBusiness).not.toHaveBeenCalled();
    });

    it('rejects an expired OTP', async () => {
      otpRepository.findOne.mockResolvedValue({
        ...validOtp,
        expires_at: new Date(Date.now() - 1_000),
      });

      await expect(
        service.verifyOtpAndRegister(REGISTER_PAYLOAD),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(businessService.registerBusiness).not.toHaveBeenCalled();
    });

    it('rejects a wrong OTP and increments the attempt counter', async () => {
      otpRepository.findOne.mockResolvedValue(validOtp);

      await expect(
        service.verifyOtpAndRegister({ ...REGISTER_PAYLOAD, otp: '000000' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(otpRepository.increment).toHaveBeenCalledWith(
        { id: 'otp-1' },
        'attempts',
        1,
      );
      expect(businessService.registerBusiness).not.toHaveBeenCalled();
      expect(otpRepository.update).not.toHaveBeenCalled();
    });

    it('rejects with 429 once the attempt limit is reached', async () => {
      otpRepository.findOne.mockResolvedValue({ ...validOtp, attempts: 5 });

      const error = await service
        .verifyOtpAndRegister(REGISTER_PAYLOAD)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect(businessService.registerBusiness).not.toHaveBeenCalled();
    });

    it('rejects when the email is already registered', async () => {
      otpRepository.findOne.mockResolvedValue(validOtp);
      businessesRepository.findOne.mockResolvedValue({ id: 'business-1' });

      await expect(
        service.verifyOtpAndRegister(REGISTER_PAYLOAD),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(businessService.registerBusiness).not.toHaveBeenCalled();
    });

    it('keeps the OTP usable when account creation fails', async () => {
      otpRepository.findOne.mockResolvedValue(validOtp);
      businessService.registerBusiness.mockRejectedValueOnce(
        new ConflictException('Username already exists'),
      );

      await expect(
        service.verifyOtpAndRegister(REGISTER_PAYLOAD),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(otpRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('cleanupExpiredOtps', () => {
    it('deletes OTP rows older than the retention window', async () => {
      otpRepository.delete.mockResolvedValue({ affected: 3 });

      await expect(service.cleanupExpiredOtps()).resolves.toBe(3);
      expect(otpRepository.delete).toHaveBeenCalledWith({
        created_at: expect.anything(),
      });
    });

    it('returns 0 when nothing was deleted', async () => {
      otpRepository.delete.mockResolvedValue({ affected: undefined });

      await expect(service.cleanupExpiredOtps()).resolves.toBe(0);
    });
  });
});
