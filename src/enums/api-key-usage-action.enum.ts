/**
 * ประเภทเหตุการณ์ใน `api_key_usage_logs.action`
 * - `QR_CREATED` : API Key ถูกใช้สร้าง PromptPay QR (นับเป็น Rate Limit)
 * - `QR_PAID`    : รายการที่สร้างด้วย API Key นี้ได้รับการชำระเงินแล้ว
 */
export enum ApiKeyUsageActionEnum {
  QR_CREATED = 'QR_CREATED',
  QR_PAID = 'QR_PAID',
}

/** Union type ของค่าในคอลัมน์ `api_key_usage_logs.action` */
export type ApiKeyUsageAction = `${ApiKeyUsageActionEnum}`;
