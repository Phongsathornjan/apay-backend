import { sha256 } from '../../common/utils/crypto.util';
import { extractApiKeyPrefix, generateApiKey } from './api-key.util';

describe('api-key.util', () => {
  describe('generateApiKey', () => {
    it('generates a live API key with matching prefix and sha256 hash', () => {
      const generated = generateApiKey();

      expect(generated.rawApiKey).toMatch(
        /^apay_live_[0-9a-f]{8}_[0-9a-f]{32}$/,
      );
      expect(generated.prefix).toMatch(/^apay_live_[0-9a-f]{8}$/);
      expect(generated.rawApiKey.startsWith(`${generated.prefix}_`)).toBe(true);
      expect(generated.hash).toBe(sha256(generated.rawApiKey));
    });
  });

  describe('extractApiKeyPrefix', () => {
    it('extracts the first 3 underscore-separated segments as prefix', () => {
      expect(
        extractApiKeyPrefix(
          'apay_live_1a2b3c4d_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c',
        ),
      ).toBe('apay_live_1a2b3c4d');
    });

    it('returns the original string when it has fewer than 4 segments', () => {
      expect(extractApiKeyPrefix('invalid_key')).toBe('invalid_key');
    });
  });
});
