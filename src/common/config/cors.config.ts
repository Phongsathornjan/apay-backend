import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * Origins allowed when `CORS_ORIGINS` is not set.
 * Covers the local frontend dev servers (Next.js/Vite commonly on 3001) and the API itself.
 */
export const DEFAULT_CORS_ORIGINS: string[] = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

export const CORS_ALLOWED_HEADERS: string[] = [
  'Accept',
  'Authorization',
  'Content-Type',
  'Origin',
  'X-Requested-With',
  'x-api-key',
  'x-correlation-id',
];

export const CORS_EXPOSED_HEADERS: string[] = [
  'x-correlation-id',
  'Content-Length',
];

/**
 * Parses a comma-separated `CORS_ORIGINS` value into a normalized list.
 * Returns `DEFAULT_CORS_ORIGINS` when the value is empty/blank.
 * Trailing slashes are stripped so `http://localhost:3001/` matches `http://localhost:3001`.
 */
export function parseCorsOrigins(raw?: string | null): string[] {
  if (!raw) {
    return [...DEFAULT_CORS_ORIGINS];
  }

  const origins = raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);

  return origins.length > 0 ? origins : [...DEFAULT_CORS_ORIGINS];
}

/**
 * Builds the Nest CORS options from the environment.
 *
 * - `CORS_ORIGINS=*` (or `CORS_ALLOW_ALL=true`) reflects any origin.
 * - Requests without an `Origin` header (curl, server-to-server, LINE webhook, payment callback)
 *   are always allowed, because they are not subject to browser CORS checks.
 */
export function buildCorsOptions(
  env: NodeJS.ProcessEnv = process.env,
): CorsOptions {
  const allowAll =
    env.CORS_ORIGINS?.trim() === '*' ||
    env.CORS_ALLOW_ALL?.trim().toLowerCase() === 'true';
  const origins = parseCorsOrigins(env.CORS_ORIGINS);

  return {
    origin: allowAll
      ? true
      : (origin, callback) => {
          if (!origin) {
            callback(null, true);
            return;
          }

          const normalized = origin.replace(/\/+$/, '');
          callback(null, origins.includes(normalized));
        },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: CORS_ALLOWED_HEADERS,
    exposedHeaders: CORS_EXPOSED_HEADERS,
    credentials: !allowAll,
    maxAge: 86_400,
  };
}
