import { SECRET_MASK, isSensitiveKey, maskBody } from './maskBody';

describe('maskBody', () => {
  it('masks sensitive fields by key and value patterns recursively', () => {
    const input = {
      phone: '0812345678',
      fbb_id: '9612345678',
      email: 'merchant@example.com',
      card_number: '4111222233334444',
      bank_account: '1234567890',
      citizen_id: '1100100200301',
      first_name: 'Somchai',
      last_name: 'Jaidee',
      full_name: 'Somchai Jaidee',
      single_name: 'Somchai',
      redirect_url: 'https://merchant.example.com/webhooks/apay?token=secret',
      bad_url: 'not-a-valid-url',
      amount: 100.25,
      items: [{ msisdn: '0899998888' }],
    };

    const masked = maskBody(input);

    expect(masked.phone).toBe('081XXX5678');
    expect(masked.fbb_id).toBe('96XXXX5678');
    expect(masked.email).toMatch(/^merX+$/);
    expect(masked.card_number).toBe('411122XXXXXX4444');
    expect(masked.bank_account).toBe('1234XXX890');
    expect(masked.citizen_id).toBe('XXXXXXXXX0301');
    expect(masked.first_name).toBe('SomXXXX');
    expect(masked.last_name).toBe('JaiXXX');
    expect(masked.full_name).toBe('Somchai XXXXX');
    expect(masked.single_name).toBe('Somchai');
    expect(masked.redirect_url).toBe('https://merchant.example.com');
    expect(masked.bad_url).toBe('not-a-valid-url');
    expect(masked.amount).toBe(100.25);
    expect(masked.items[0].msisdn).toBe('089XXX8888');
  });

  it('handles null, primitives, and arrays safely', () => {
    expect(maskBody(null)).toBeNull();
    expect(maskBody(undefined)).toBeUndefined();
    expect(maskBody(['0812345678', 'plain'])).toEqual(['081XXX5678', 'plain']);
  });

  describe('secrets', () => {
    it('masks password fields from login/registration bodies', () => {
      const masked = maskBody({
        username: 'admin',
        password: 'Dylancarr11&',
        new_password: 'N3wPassw0rd!',
        password_hash: '$2b$10$abcdefghijklmnopqrstuv',
      });

      expect(masked.username).toBe('admin');
      expect(masked.password).toBe(SECRET_MASK);
      expect(masked.new_password).toBe(SECRET_MASK);
      expect(masked.password_hash).toBe(SECRET_MASK);
    });

    it('masks tokens in both request and response bodies', () => {
      const masked = maskBody({
        access_token: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
        refresh_token: 'eyJhbGciOiJIUzI1NiJ9.refresh.signature',
        refresh_token_hash: 'abc123hash',
        token: 'raw-token',
        token_type: 'Bearer',
        expires_in: 900,
      });

      expect(masked.access_token).toBe(SECRET_MASK);
      expect(masked.refresh_token).toBe(SECRET_MASK);
      expect(masked.refresh_token_hash).toBe(SECRET_MASK);
      expect(masked.token).toBe(SECRET_MASK);
      // ไม่ใช่ความลับ — ต้องอ่านได้ตามปกติ
      expect(masked.token_type).toBe('Bearer');
      expect(masked.expires_in).toBe(900);
    });

    it('masks webhook secrets and API keys but keeps their identifiers', () => {
      const masked = maskBody({
        app: 'K_PLUS',
        'x-webhook-secret': '1e3f0b7d-4c5a-4e2f-8c6b-9a1b2c3d4e5f',
        webhook_secret: '1e3f0b7d-4c5a-4e2f-8c6b-9a1b2c3d4e5f',
        api_key: 'apay_live_0a1b2c3d_0123456789abcdef0123456789abcdef',
        client_secret: 'shhh',
        api_key_id: '8b9c5a1e-2f3d-4e5f-8a9b-0c1d2e3f4a5b',
        api_key_prefix: 'apay_live_0a1b2c3d',
      });

      expect(masked.app).toBe('K_PLUS');
      expect(masked['x-webhook-secret']).toBe(SECRET_MASK);
      expect(masked.webhook_secret).toBe(SECRET_MASK);
      expect(masked.api_key).toBe(SECRET_MASK);
      expect(masked.client_secret).toBe(SECRET_MASK);
      // identifier / prefix ใช้ debug ได้ ไม่ใช่ความลับ
      expect(masked.api_key_id).toBe('8b9c5a1e-2f3d-4e5f-8a9b-0c1d2e3f4a5b');
      expect(masked.api_key_prefix).toBe('apay_live_0a1b2c3d');
    });

    it('masks OTP codes including non-string values', () => {
      const masked = maskBody({
        email: 'user@example.com',
        otp: '123456',
        otp_code: '654321',
        otp_hash: 'sha256hash',
        otp_as_number: 123456,
      });

      expect(masked.email).toMatch(/^useX+$/);
      expect(masked.otp).toBe(SECRET_MASK);
      expect(masked.otp_code).toBe(SECRET_MASK);
      expect(masked.otp_hash).toBe(SECRET_MASK);
      expect(masked.otp_as_number).toBe(SECRET_MASK);
    });

    it('masks nested secrets and keeps the structure', () => {
      const masked = maskBody({
        user: { username: 'somchai', password: 'secret-pass' },
        items: [{ api_key: 'apay_live_aaaabbbb_cccc' }],
        credentials: { username: 'somchai', secret: 'top-secret' },
      });

      expect(masked.user.username).toBe('somchai');
      expect(masked.user.password).toBe(SECRET_MASK);
      expect(masked.items[0].api_key).toBe(SECRET_MASK);
      expect(masked.credentials).toEqual({
        username: SECRET_MASK,
        secret: SECRET_MASK,
      });
    });

    it('keeps null/undefined secret values as-is', () => {
      const masked = maskBody({ password: null, refresh_token: undefined });

      expect(masked.password).toBeNull();
      expect(masked.refresh_token).toBeUndefined();
    });

    it('does not re-mask values already masked by maskHeaders', () => {
      const masked = maskBody({
        authorization: 'Bearer a***cdef',
        'x-refresh-token': 'abcd***wxyz',
        'set-cookie': 'token=ab***Only',
      });

      expect(masked.authorization).toBe('Bearer a***cdef');
      expect(masked['x-refresh-token']).toBe('abcd***wxyz');
      expect(masked['set-cookie']).toBe('token=ab***Only');
    });

    it('masks secrets inside arrays of strings', () => {
      const masked = maskBody({ cookie: ['session=abcdef0123456789'] });

      expect(masked.cookie).toEqual([SECRET_MASK]);
    });
  });

  describe('isSensitiveKey', () => {
    it.each([
      'password',
      'Password',
      'newPassword',
      'password_hash',
      'secret',
      'x-webhook-secret',
      'client_secret',
      'token',
      'access_token',
      'refresh_token_hash',
      'x-refresh-token',
      'otp',
      'otp_hash',
      'api_key',
      'x-api-key',
      'private_key',
      'authorization',
    ])('detects %s as sensitive', (key) => {
      expect(isSensitiveKey(key)).toBe(true);
    });

    it.each([
      'username',
      'email',
      'amount',
      'business_name',
      'api_key_id',
      'api_key_prefix',
      'token_type',
      'expires_in',
      'redirect_url',
      '',
    ])('does not treat %s as sensitive', (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    });
  });
});
