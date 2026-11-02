/**
 * Payload กลางที่ iOS Shortcut ส่งต่อมาจากการแจ้งเตือนของแอปธนาคาร
 *
 * ตัวอย่าง (KBank / K PLUS):
 * {
 *   "app": "K_PLUS",
 *   "title": "รายการเงินเข้า",
 *   "body": "บัญชี xxx-x-x8583-x  จำนวนเงิน 1.00 บาท  วันที่ 1 พ.ย. 69  22:57 น."
 * }
 */
export interface IosNotificationBody {
  /**
   * แอปธนาคารต้นทาง (เช่น `K_PLUS`) — ใช้เลือก parser ของแต่ละธนาคาร
   * ถ้าไม่ส่งมา หรือส่งค่าที่ไม่รองรับ ระบบจะตอบ `400` ว่าไม่รองรับ
   */
  app?: string;
  title?: string;
  body?: string;
  /**
   * เวลาที่แจ้งเตือนถูกส่งมา (epoch ms หรือ ISO string) ใช้เป็น fallback
   * เมื่อข้อความใน `body` ไม่มีวันเวลา
   */
  timestamp?: number | string;
  [key: string]: unknown;
}
