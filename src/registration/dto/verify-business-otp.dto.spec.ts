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

  it('validates the business fields declared on this DTO', async () => {
    const errors = await validateDto({
      ...VALID_PAYLOAD,
      email: 'not-an-email',
    });

    expect(propertyErrors(errors)).toContain('email');
  });

  it.each(['username', 'password', 'business_name', 'email', 'promptpay_id'])(
    'requires the business field %s',
    async (field) => {
      const payload: Record<string, unknown> = { ...VALID_PAYLOAD };
      delete payload[field];

      const errors = await validateDto(payload);

      expect(propertyErrors(errors)).toContain(field);
    },
  );

  it('rejects an invalid promptpay_id', async () => {
    const errors = await validateDto({ ...VALID_PAYLOAD, promptpay_id: '123' });

    expect(propertyErrors(errors)).toContain('promptpay_id');
  });

  it('accepts optional line fields and package_id but rejects a non-uuid package_id', async () => {
    await expect(
      validateDto({
        ...VALID_PAYLOAD,
        line_destination: 'U-destination',
        line_user_id: 'U-owner',
        package_id: '0f8fad5b-d9cb-469f-a165-70867728950e',
      }),
    ).resolves.toHaveLength(0);

    const errors = await validateDto({
      ...VALID_PAYLOAD,
      package_id: 'not-a-uuid',
    });

    expect(propertyErrors(errors)).toContain('package_id');
  });
});
