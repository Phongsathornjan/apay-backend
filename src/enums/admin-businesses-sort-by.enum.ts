/**
 * คอลัมน์ที่อนุญาตให้ใช้เรียงลำดับใน Admin Businesses Table (`?sort_by=`)
 */
export enum AdminBusinessesSortByEnum {
  GMV = 'gmv',
  QR_CREATED = 'qr_created',
  QR_PAID = 'qr_paid',
  QUOTA_USED = 'quota_used',
  CURRENT_PERIOD_END = 'current_period_end',
  CREATED_AT = 'created_at',
}

/** Union type ของค่า query parameter `sort_by` ใน Admin Businesses API */
export type AdminBusinessesSortBy = `${AdminBusinessesSortByEnum}`;
