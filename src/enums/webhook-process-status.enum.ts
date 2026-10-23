/**
 * ผลลัพธ์การประมวลผล LINE Webhook (`webhook_logs.process_status`)
 * - `MATCHED`   : พบ Payment Order ที่ตรงกันและบันทึกเป็น `PAID` แล้ว
 * - `NO_MATCH`  : parse ข้อความได้แต่ไม่พบ Order ที่ตรงกัน
 * - `DUPLICATE` : ข้อความนี้เคยถูกประมวลผลไปแล้ว (idempotency)
 * - `IGNORED`   : ไม่ใช่ข้อความแจ้งโอนที่ระบบรองรับ
 */
export enum WebhookProcessStatusEnum {
  MATCHED = 'MATCHED',
  NO_MATCH = 'NO_MATCH',
  DUPLICATE = 'DUPLICATE',
  IGNORED = 'IGNORED',
}

/** Union type ของค่าในคอลัมน์ `webhook_logs.process_status` */
export type WebhookProcessStatus = `${WebhookProcessStatusEnum}`;
