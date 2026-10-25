import { maskHeaders } from './maskHeaders';

describe('maskHeaders', () => {
  it('masks sensitive headers and keeps the rest readable', () => {
    const masked = maskHeaders({
      authorization: 'Bearer apay_live_1234567890abcdef',
      'x-api-key': 'apay_live_1234567890abcdef',
      'content-type': 'application/json',
      'x-correlation-id': 'corr-1',
    });

    expect(masked).toEqual({
      authorization: 'Bearer a***cdef',
      'x-api-key': 'apay_liv***cdef',
      'content-type': 'application/json',
      'x-correlation-id': 'corr-1',
    });
  });

  it('masks sensitive headers case-insensitively and masks short values fully', () => {
    const masked = maskHeaders({
      Authorization: 'short',
      Cookie: ['session=abcdef0123456789'],
      'Set-Cookie': 'token=abcdef0123456789; HttpOnly',
    });

    expect(masked).toEqual({
      Authorization: '***',
      Cookie: ['session=***6789'],
      'Set-Cookie': 'token=ab***Only',
    });
  });

  it('applies body masking rules to plain header values', () => {
    const masked = maskHeaders({ 'x-user-phone': '0812345678' });

    expect(masked).toEqual({ 'x-user-phone': '081XXX5678' });
  });

  it('returns null for missing or invalid headers', () => {
    expect(maskHeaders()).toBeNull();
    expect(maskHeaders(null)).toBeNull();
    expect(maskHeaders('not-headers' as any)).toBeNull();
  });

  it('skips undefined header values', () => {
    const masked = maskHeaders({ 'x-a': undefined, 'x-b': 'value' });

    expect(masked).toEqual({ 'x-b': 'value' });
  });
});
