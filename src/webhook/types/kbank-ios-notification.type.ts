/**
 * Payload ที่ iOS Shortcut ส่งต่อมาจากการแจ้งเตือนของแอป KBank (K PLUS)
 *
 * ตัวอย่าง:
 * {
 *   "app": "K_PLUS",
 *   "title": "รายการเงินเข้า",
 *   "body": "บัญชี xxx-x-x8583-x  จำนวนเงิน 1.00 บาท  วันที่ 1 พ.ย. 69  22:57 น."
 * }
 */
export interface KbankIosNotificationBody {
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
