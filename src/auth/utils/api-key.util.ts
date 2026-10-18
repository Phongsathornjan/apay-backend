import { randomBytes } from 'node:crypto';
import { sha256 } from '../../common/utils/crypto.util';

export interface GeneratedApiKey {
  rawApiKey: string;
  prefix: string;
  hash: string;
}

/**
 * สร้าง API Key รูปแบบ `apay_live_<8_hex_prefix>_<32_hex_secret>`
 */
export function generateApiKey(): GeneratedApiKey {
  const prefix = `apay_live_${randomBytes(4).toString('hex')}`;
  const secret = randomBytes(16).toString('hex');
  const rawApiKey = `${prefix}_${secret}`;

  return {
    rawApiKey,
    prefix,
    hash: sha256(rawApiKey),
  };
}

/**
 * ตัดเอา `api_key_prefix` (เช่น `apay_live_1a2b3c4d`) ออกจาก API Key เต็ม
 */
export function extractApiKeyPrefix(apiKey: string): string {
  const parts = apiKey.split('_');

  if (parts.length < 4) {
    return apiKey;
  }

  return parts.slice(0, 3).join('_');
}
