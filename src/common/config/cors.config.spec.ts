import type { CustomOrigin } from '@nestjs/common/interfaces/external/cors-options.interface';
import {
  buildCorsOptions,
  CORS_ALLOWED_HEADERS,
  CORS_EXPOSED_HEADERS,
  DEFAULT_CORS_ORIGINS,
  parseCorsOrigins,
} from './cors.config';

type OriginCallback = (err: Error | null, allow?: unknown) => void;

function checkOrigin(options: ReturnType<typeof buildCorsOptions>, origin?: string): boolean {
  const custom = options.origin as CustomOrigin;
  let allowed: unknown;
  const callback: OriginCallback = (err, allow) => {
    expect(err).toBeNull();
    allowed = allow;
  };

  custom(origin, callback);

  return allowed === true;
}

describe('cors.config', () => {
  describe('parseCorsOrigins', () => {
    it('returns the default origins when the value is missing or blank', () => {
      expect(parseCorsOrigins()).toEqual(DEFAULT_CORS_ORIGINS);
      expect(parseCorsOrigins('')).toEqual(DEFAULT_CORS_ORIGINS);
      expect(parseCorsOrigins('   ')).toEqual(DEFAULT_CORS_ORIGINS);
      expect(parseCorsOrigins(', ,')).toEqual(DEFAULT_CORS_ORIGINS);
    });

    it('splits a comma-separated list, trims whitespace and strips trailing slashes', () => {
      expect(
        parseCorsOrigins(' http://localhost:3001/ , https://apay.app/,,'),
      ).toEqual(['http://localhost:3001', 'https://apay.app']);
    });

    it('returns a copy so callers cannot mutate the defaults', () => {
      const origins = parseCorsOrigins();
      origins.push('http://evil.test');

      expect(DEFAULT_CORS_ORIGINS).not.toContain('http://evil.test');
    });
  });

  describe('buildCorsOptions', () => {
    it('allows the localhost frontend origin by default', () => {
      const options = buildCorsOptions({} as NodeJS.ProcessEnv);

      expect(checkOrigin(options, 'http://localhost:3001')).toBe(true);
      expect(options.credentials).toBe(true);
      expect(options.methods).toContain('OPTIONS');
      expect(options.allowedHeaders).toEqual(CORS_ALLOWED_HEADERS);
      expect(options.exposedHeaders).toEqual(CORS_EXPOSED_HEADERS);
    });

    it('rejects unknown browser origins', () => {
      const options = buildCorsOptions({} as NodeJS.ProcessEnv);

      expect(checkOrigin(options, 'https://evil.test')).toBe(false);
    });

    it('always allows requests without an Origin header (curl, server-to-server)', () => {
      const options = buildCorsOptions({
        CORS_ORIGINS: 'https://app.apay.test',
      } as unknown as NodeJS.ProcessEnv);

      expect(checkOrigin(options, undefined)).toBe(true);
      expect(checkOrigin(options, 'https://app.apay.test')).toBe(true);
      expect(checkOrigin(options, 'https://app.apay.test/')).toBe(true);
      expect(checkOrigin(options, 'http://localhost:3001')).toBe(false);
    });

    it('reflects any origin when CORS_ORIGINS is a wildcard', () => {
      const options = buildCorsOptions({
        CORS_ORIGINS: '*',
      } as unknown as NodeJS.ProcessEnv);

      expect(options.origin).toBe(true);
      expect(options.credentials).toBe(false);
    });

    it('reflects any origin when CORS_ALLOW_ALL is true (case insensitive)', () => {
      const options = buildCorsOptions({
        CORS_ALLOW_ALL: ' TRUE ',
      } as unknown as NodeJS.ProcessEnv);

      expect(options.origin).toBe(true);
      expect(options.credentials).toBe(false);
    });
  });
});
