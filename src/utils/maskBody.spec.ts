import { maskBody } from './maskBody';

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
});
