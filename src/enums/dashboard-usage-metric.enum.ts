/**
 * Metric ที่เลือกดูจาก Usage Timeseries (`?metric=`)
 * - `qr_created`     : จำนวนครั้งที่สร้าง QR
 * - `qr_paid`        : จำนวนครั้งที่ QR ถูกชำระ
 * - `quota_deducted` : จำนวนครั้งที่ตัดโควต้าจริง (QR_PAID + quota_deducted = true)
 */
export enum DashboardUsageMetricEnum {
  QR_CREATED = 'qr_created',
  QR_PAID = 'qr_paid',
  QUOTA_DEDUCTED = 'quota_deducted',
}

/** Union type ของค่า query parameter `metric` ใน Dashboard APIs */
export type DashboardUsageMetric = `${DashboardUsageMetricEnum}`;
