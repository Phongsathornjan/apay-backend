import type { KbankIosNotificationBody } from '../types/kbank-ios-notification.type';
import { ParsedKBankMessage, parseKBankMessage } from './kbank-message.parser';

/**
 * คำที่บ่งชี้ว่าเป็นการแจ้งเตือน "เงินออก" (ไม่ใช่รายรับ)
 * ต้องไม่ถูกนำไปจับคู่กับ Order รับเงินเด็ดขาด
 */
const MONEY_OUT_KEYWORDS = [
  'เงินออก',
  'รายการเงินออก',
  'โอนออก',
  'ถอนเงิน',
  'จ่ายบิล',
  'ชำระบิล',
];

function resolveFallbackTimestamp(
  timestamp: KbankIosNotificationBody['timestamp'],
): number | undefined {
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return timestamp;
  }

  if (typeof timestamp === 'string') {
    const numeric = Number(timestamp);

    if (Number.isFinite(numeric)) {
      return numeric;
    }

    const parsed = new Date(timestamp).getTime();

    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

/**
 * แกะยอดเงินและวันเวลาจาก Payload แจ้งเตือนของแอป KBank ที่ iOS Shortcut ส่งมา
 * (`{ app, title, body }`) แล้วคืนค่าในรูปแบบเดียวกับ {@link parseKBankMessage}
 *
 * คืนค่า `null` เมื่อ:
 * - ไม่มีข้อความให้แกะ
 * - เป็นการแจ้งเตือนเงินออก
 * - ไม่พบยอดเงินทศนิยม 2 ตำแหน่งในข้อความ
 */
export function parseKbankIosNotification(
  payload: KbankIosNotificationBody | null | undefined,
  fallbackTimestamp?: number,
): ParsedKBankMessage | null {
  const title = typeof payload?.title === 'string' ? payload.title : '';
  const body = typeof payload?.body === 'string' ? payload.body : '';

  if (!body.trim()) {
    return null;
  }

  if (MONEY_OUT_KEYWORDS.some((keyword) => title.includes(keyword))) {
    return null;
  }

  const text = title ? `${title}\n${body}` : body;
  const timestamp = fallbackTimestamp ?? resolveFallbackTimestamp(payload?.timestamp);

  return parseKBankMessage(text, timestamp);
}
