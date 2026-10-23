import { numericTransformer } from './numeric.transformer';

describe('numericTransformer', () => {
  it('passes through values in "to"', () => {
    expect(numericTransformer.to(123.45)).toBe(123.45);
    expect(numericTransformer.to(null)).toBeNull();
    expect(numericTransformer.to(undefined)).toBeUndefined();
  });

  it('converts string numbers to JS numbers in "from" and preserves null/numbers', () => {
    expect(numericTransformer.from('100.25')).toBe(100.25);
    expect(numericTransformer.from(499)).toBe(499);
    expect(numericTransformer.from(null)).toBeNull();
    expect(numericTransformer.from(undefined)).toBeNull();
  });
});
