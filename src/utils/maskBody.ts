type AnyObject = Record<string, any>;

/**
 * ค่าที่ใช้แทนความลับทั้งหมด (ไม่เก็บทั้งตัวแรกและตัวท้าย
 * เพื่อไม่ให้เดาความยาว/รูปแบบของรหัสผ่านหรือ token ได้)
 */
export const SECRET_MASK = '***';

/**
 * คำที่บ่งชี้ว่าคีย์นั้นเก็บ "ความลับ" → ต้องปิดบังค่าทั้งหมด
 * (เทียบกับคีย์ที่ normalize แล้ว: ตัวพิมพ์เล็ก + ตัด `_`, `-`, ช่องว่าง ออก)
 *
 * ครอบคลุม:
 * - `password`, `new_password`, `password_hash` → password
 * - `secret`, `client_secret`, `x-webhook-secret` → secret
 * - `token`, `access_token`, `refresh_token`, `x-refresh-token`, `refresh_token_hash` → token
 * - `otp`, `otp_hash`, `otp_code` → otp
 * - `api_key` (ค่าคีย์จริง), `x-api-key` → apikey
 * - `credential(s)`, `private_key`, `authorization`, `cookie`/`set-cookie`
 */
const SECRET_KEY_PATTERN =
  /(password|passwd|secret|token|otp|apikey|credential|privatekey|authorization|cookie)/;

/**
 * คีย์ที่ "ดูเหมือนความลับ" แต่จริง ๆ เป็นข้อมูลอ้างอิงที่ต้องอ่านได้ใน log
 * (ค่าในตาราง normalize แล้ว) — เช่น id ของคีย์, prefix ที่เปิดเผยได้, ชนิดของ token
 */
const SAFE_KEYS = new Set([
  'apikeyid',
  'apikeyprefix',
  'tokentype',
  'tokenexpiresin',
  'tokenexpiresat',
]);

/**
 * คีย์นี้เก็บความลับหรือไม่ (ใช้ปิดบังทั้งค่า ไม่ว่า value จะเป็นชนิดไหน)
 */
export const isSensitiveKey = (key: string): boolean => {
  if (!key) {
    return false;
  }

  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (SAFE_KEYS.has(normalized)) {
    return false;
  }

  return SECRET_KEY_PATTERN.test(normalized);
};

export const maskBody = (
  input: any,
): any => {

  // ---------- helper ----------
  const keepStartEnd = (str: string, keepStart: number, keepEnd: number) => {
    const start = str.slice(0, keepStart);
    const end = keepEnd > 0 ? str.slice(-keepEnd) : '';
    const middle = 'X'.repeat(Math.max(str.length - keepStart - keepEnd, 0));
    return start + middle + end;
  };

  // ---------- detector ----------
  const detectType = (key: string, value: string): string => {
    const k = key.toLowerCase();

    if (k.includes('phone') || k.includes('msisdn') || /^0\d{9}$/.test(value)) {
      return 'phone';
    }

    if(k.includes('fbb_id')){
      return 'fbbId'
    }

    if (k.includes('email')) {
      return 'email';
    }

    if (k.includes('card')) {
      return 'card';
    }

    if (k.includes('bank_account')) {
      return 'bankAccount';
    }

    if (k.includes('citizen_id')) {
      return 'citizenId';
    }

    if (k.includes('first_name')) {
      return 'firstName';
    }

    if (k.includes('last_name')) {
      return 'lastName';
    }

    if (k.includes('name')) {
      return 'name';
    }

    if (k.includes('url') || k.includes('link')) {
      return 'url';
    }

    return 'none';
  };

  // ---------- masking ----------
  const maskValue = (type: string, value: string): string => {

    switch (type) {
      case 'phone':
        return keepStartEnd(value, 3, 4);

      case 'fbbId':
        return keepStartEnd(value, 2, 4);

      case 'citizenId':
        return keepStartEnd(value, 0, 4);

      case 'card':
        return keepStartEnd(value, 6, 4);

      case 'bankAccount':
        return keepStartEnd(value, 4, 3);

      case 'email':
        return keepStartEnd(value,3,0)

      case 'name': {
        const [first, last] = value.trim().split(' ');
        if (!last) return value;
        return `${first} XXXXX`;
      }

      case 'firstName':
        return keepStartEnd(value,3,0)

      case 'lastName':
        return keepStartEnd(value,3,0)

      case 'url':
        try {
          const u = new URL(value);
          return `${u.protocol}//${u.hostname}`;
        } catch {
          return value;
        }

      default:
        return value;
    }
  };

  /**
   * ปิดบังค่าของคีย์ที่เป็นความลับทั้งก้อน
   * - ค่าที่ถูก maskHeaders ปิดบังไว้แล้ว (มี `***` อยู่) ปล่อยผ่าน
   *   เพื่อไม่ให้ mask ซ้ำจนเสียรูปแบบ `<first 8>***<last 4>` เดิม
   * - number/boolean ก็ปิดบัง (เช่น `otp: 123456`)
   * - object/array คงโครงสร้างไว้ แต่ปิดบัง leaf ทุกตัว
   */
  const maskSecret = (data: any): any => {
    if (data === null || data === undefined) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => maskSecret(item));
    }

    if (typeof data === 'object') {
      const result: AnyObject = {};
      for (const key in data) {
        result[key] = maskSecret(data[key]);
      }
      return result;
    }

    if (typeof data === 'string') {
      return data.includes(SECRET_MASK) ? data : SECRET_MASK;
    }

    return SECRET_MASK;
  };

  // ---------- recursive ----------
  const processWithKey = (data: any, parentKey = ''): any => {
    // ความลับต้องถูกปิดบังก่อน detector อื่นทั้งหมด (เช่น `password` ไม่ควรถูกมองเป็น name)
    if (isSensitiveKey(parentKey)) {
      return maskSecret(data);
    }

    if (Array.isArray(data)) {
      return data.map((item) => processWithKey(item, parentKey));
    }

    if (data !== null && typeof data === 'object') {
      const result: AnyObject = {};
      for (const key in data) {
        result[key] = processWithKey(data[key], key);
      }
      return result;
    }

    if (typeof data === 'string') {
      const type = detectType(parentKey, data);
      return maskValue(type, data);
    }

    return data;
  };

  return processWithKey(input);
}
