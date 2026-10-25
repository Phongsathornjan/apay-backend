import { maskBody } from './maskBody';

/**
 * Header ที่ถือเป็นความลับและต้องถูกปิดบังก่อนลง log
 * (เทียบแบบ case-insensitive เพราะ HTTP header ไม่สนตัวพิมพ์เล็ก/ใหญ่)
 */
export const SENSITIVE_HEADER_KEYS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-refresh-token',
  'refresh-token',
  'access-token',
  'x-line-signature',
] as const;

const SENSITIVE_HEADERS = new Set<string>(SENSITIVE_HEADER_KEYS);

const MASK_PREFIX_LENGTH = 8;
const MASK_SUFFIX_LENGTH = 4;
const SHORT_VALUE_MASK = '***';

export type LogHeaders = Record<string, any>;

const maskHeaderValue = (value: any): any => {
  if (Array.isArray(value)) {
    return value.map(maskHeaderValue);
  }

  if (typeof value !== 'string') {
    return value;
  }

  if (value.length <= MASK_PREFIX_LENGTH + MASK_SUFFIX_LENGTH) {
    return SHORT_VALUE_MASK;
  }

  return `${value.slice(0, MASK_PREFIX_LENGTH)}${SHORT_VALUE_MASK}${value.slice(
    -MASK_SUFFIX_LENGTH,
  )}`;
};

/**
 * ปิดบัง header ที่เป็นความลับ (เช่น authorization, cookie, x-api-key)
 * แล้วส่งค่าที่เหลือผ่าน maskBody เพื่อกัน PII หลุดออกไปใน log
 */
export const maskHeaders = (headers?: LogHeaders | null): LogHeaders | null => {
  if (!headers || typeof headers !== 'object') {
    return null;
  }

  const masked: LogHeaders = {};

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    masked[key] = SENSITIVE_HEADERS.has(key.toLowerCase())
      ? maskHeaderValue(value)
      : value;
  }

  return maskBody(masked) ?? {};
};
