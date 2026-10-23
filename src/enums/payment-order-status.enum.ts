/**
 * สถานะของ Payment Order (`payment_orders.status`)
 * - `UNVERIFIED` : สร้าง QR สำเร็จแล้ว รอตรวจสอบรายการโอน
 * - `PAID`       : พบรายการโอนที่ตรงกับ lookup key แล้ว
 * - `EXPIRED`    : หมดอายุ (QR TTL 5 นาที) โดยยังไม่ได้รับการชำระ
 */
export enum PaymentOrderStatusEnum {
  UNVERIFIED = 'UNVERIFIED',
  PAID = 'PAID',
  EXPIRED = 'EXPIRED',
}

/** Union type ของค่าในคอลัมน์ `payment_orders.status` */
export type PaymentOrderStatus = `${PaymentOrderStatusEnum}`;
