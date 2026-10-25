import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterBusinessDto } from './register-business.dto';

const VALID_PAYLOAD = {
  username: 'merchant',
  password: 'StrongPass123!',
  business_name: 'Coffee Shop',
  email: 'owner@coffee-shop.com',
  promptpay_id: '0812345678',
};

async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(RegisterBusinessDto, payload);

  return validate(dto, { whitelist: true });
}

function propertyErrors(
  errors: Awaited<ReturnType<typeof validateDto>>,
): string[] {
  return errors.map((error) => error.property);
}

describe('RegisterBusinessDto', () => {
  it('accepts a payload that includes a valid email', async () => {
    await expect(validateDto(VALID_PAYLOAD)).resolves.toHaveLength(0);
  });

  it('requires email', async () => {
    const { email: _email, ...payload } = VALID_PAYLOAD;

    const errors = await validateDto(payload);

    expect(propertyErrors(errors)).toContain('email');
  });

  it.each([
    'not-an-email',
    'owner@',
    '@coffee-shop.com',
    'owner coffee@shop.com',
    'owner@coffee',
  ])('rejects an invalid email: %s', async (email) => {
    const errors = await validateDto({ ...VALID_PAYLOAD, email });

    expect(propertyErrors(errors)).toContain('email');
  });

  it('rejects an email longer than 255 characters', async () => {
    const email = `${'a'.repeat(250)}@example.com`;

    const errors = await validateDto({ ...VALID_PAYLOAD, email });

    expect(propertyErrors(errors)).toContain('email');
  });
});
