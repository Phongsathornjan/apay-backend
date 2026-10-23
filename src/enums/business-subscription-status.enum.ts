/**
 * สถานะของ Subscription (`business_subscriptions.status`)
 * - `ACTIVE`    : ชำระแล้วและยังอยู่ภายใน paid-through date (`current_period_end`)
 * - `PAST_DUE`  : เลยกำหนดชำระแล้ว — ถูกตัดสิทธิ์และ `quota_remaining = 0`
 * - `CANCELLED` : ถูกยกเลิกก่อนกำหนด
 */
export enum BusinessSubscriptionStatusEnum {
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELLED = 'CANCELLED',
}

/** Union type ของค่าในคอลัมน์ `business_subscriptions.status` */
export type BusinessSubscriptionStatus = `${BusinessSubscriptionStatusEnum}`;
