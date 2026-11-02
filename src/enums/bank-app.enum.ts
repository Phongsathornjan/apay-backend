/**
 * แอปธนาคารต้นทางที่ส่งแจ้งเตือนเงินเข้าผ่าน iOS Shortcut ได้
 *
 * ค่าต้องตรงกับฟิลด์ `app` ใน body ของ Webhook (`POST /api/v1/webhooks/ios-notify`)
 * และถูกใช้เป็น key เลือก parser ของแต่ละธนาคารที่ `src/webhook/utils/ios-notification.parser.ts`
 */
export enum BankAppEnum {
  /** KBank (แอป K PLUS) */
  KBANK_K_PLUS = 'K_PLUS',
}

export type BankApp = `${BankAppEnum}`;
