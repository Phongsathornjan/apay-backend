import { Test, TestingModule } from '@nestjs/testing';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';

describe('RegistrationController', () => {
  let controller: RegistrationController;

  const registrationService = {
    requestOtp: jest.fn(),
    verifyOtpAndRegister: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RegistrationController],
      providers: [
        { provide: RegistrationService, useValue: registrationService },
      ],
    }).compile();

    controller = module.get<RegistrationController>(RegistrationController);
  });

  it('delegates requestOtp to RegistrationService.requestOtp', async () => {
    const dto = { email: 'owner@example.com' };
    registrationService.requestOtp.mockResolvedValue({ email: dto.email });

    await expect(controller.requestOtp(dto)).resolves.toEqual({
      email: dto.email,
    });
    expect(registrationService.requestOtp).toHaveBeenCalledWith(dto);
  });

  it('delegates verifyOtp to RegistrationService.verifyOtpAndRegister', async () => {
    const dto = {
      email: 'owner@example.com',
      otp: '123456',
      username: 'merchant',
      password: 'StrongPass123!',
      business_name: 'Coffee Shop',
      promptpay_id: '0812345678',
    };
    registrationService.verifyOtpAndRegister.mockResolvedValue({
      business_id: 'business-1',
    });

    await expect(controller.verifyOtp(dto)).resolves.toEqual({
      business_id: 'business-1',
    });
    expect(registrationService.verifyOtpAndRegister).toHaveBeenCalledWith(dto);
  });
});
