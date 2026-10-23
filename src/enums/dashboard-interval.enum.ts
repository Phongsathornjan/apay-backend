/**
 * ความละเอียดของ Bucket ที่ Dashboard ใช้แบ่งช่วงเวลา (`?interval=`)
 * - `hour` : bucket ละ 1 ชั่วโมง (ใช้ได้เฉพาะช่วง <= 31 วัน)
 * - `day`  : bucket ละ 1 วัน เริ่มที่ 00:00 `Asia/Bangkok`
 */
export enum DashboardIntervalEnum {
  HOUR = 'hour',
  DAY = 'day',
}

/** Union type ของค่า query parameter `interval` */
export type DashboardInterval = `${DashboardIntervalEnum}`;
