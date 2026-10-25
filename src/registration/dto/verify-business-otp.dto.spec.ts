import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VerifyBusinessOtpDto } from './verify-business-otp.dto';

const VALID_PAYLOAD = {
  email: 'owner@example.com',
  otp: '123456',
  username: 'merchant',
  password: 'StrongPass123!',
  business_name: 'Coffee Shop',
  promptpay_id: '0812345678',
};

async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(VerifyBusinessOtpDto, payload);

  return validate(dto, { whitelist: true });
}

function propertyErrors(
  errors: Awaited<ReturnType<typeof validateDto>>,
): string[] {
  return errors.map((error) => error.property);
}

describe('VerifyBusinessOtpDto', () => {
  it('accepts a valid registration payload with a 6-digit OTP', async () => {
    await expect(validateDto(VALID_PAYLOAD)).resolves.toHaveLength(0);
  });

  it('normalizes the email to lowercase and trims it', () => {
    const dto = plainToInstance(VerifyBusinessOtpDto, {
      ...VALID_PAYLOAD,
      email: '  Owner@Example.COM ',
    });

    expect(dto.email).toBe('owner@example.com');
  });

  it('requires otp', async () => {
    const { otp: _otp, ...payload } = VALID_PAYLOAD;

    const errors = await validateDto(payload);

    expect(propertyErrors(errors)).toContain('otp');
  });

  it.each(['12345', '1234567', 'abcdef', '12 456'])(
    'rejects a non 6-digit otp: %s',
    async (otp) => {
      const errors = await validateDto({ ...VALID_PAYLOAD, otp });

      expect(propertyErrors(errors)).toContain('otp');
    },
  );

  it('still validates the inherited registration fields', async () => {
    const errors = await validateDto({
      ...VALID_PAYLOAD,
      email: 'not-an-email',
    });

    expect(propertyErrors(errors)).toContain('email');
  });
});
