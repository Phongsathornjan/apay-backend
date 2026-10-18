import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * สร้าง SHA-256 Hash (hex) จากค่าที่กำหนด ใช้สำหรับเก็บ API Key และ Refresh Token
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * เปรียบเทียบ String แบบ Constant-Time เพื่อป้องกัน Timing Attack
 */
export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}
