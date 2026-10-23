import { safeCompare, sha256 } from './crypto.util';

describe('crypto.util', () => {
  describe('sha256', () => {
    it('produces a deterministic 64-character hex SHA-256 digest', () => {
      const digest = sha256('hello-apay');
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      expect(sha256('hello-apay')).toBe(digest);
      expect(sha256('different')).not.toBe(digest);
    });
  });

  describe('safeCompare', () => {
    it('returns true for identical strings', () => {
      expect(safeCompare('secret-value', 'secret-value')).toBe(true);
    });

    it('returns false for strings with same length but different content', () => {
      expect(safeCompare('secret-value', 'secret-valux')).toBe(false);
    });

    it('returns false for strings with different lengths', () => {
      expect(safeCompare('short', 'much-longer-string')).toBe(false);
    });
  });
});
