import { BankAppEnum, BankApp } from '../../enums';
import type { IosNotificationBody } from '../types/ios-notification.type';
import { parseKbankIosNotification } from './kbank-ios-notification.parser';
import type { ParsedKBankMessage } from './kbank-message.parser';

/**
 * Signature ของ parser ประจำธนาคาร — รับ payload กลางแล้วคืนยอดเงิน/วันเวลา
 * (หรือ `null` เมื่อข้อความใช้ไม่ได้ เช่น เป็นแจ้งเตือนเงินออก)
 */
export type BankNotificationParser = (
  payload: IosNotificationBody | null | undefined,
  fallbackTimestamp?: number,
) => ParsedKBankMessage | null;

/**
 * Registry ของ parser แยกตามธนาคาร — `Record<BankApp, ...>` ทำให้ TypeScript
 * บังคับให้ทุกค่าที่เพิ่มใน `BankAppEnum` ต้องมี parser ก่อน build ผ่าน
 */
const BANK_NOTIFICATION_PARSERS: Record<BankApp, BankNotificationParser> = {
  [BankAppEnum.KBANK_K_PLUS]: parseKbankIosNotification,
};

/** รายชื่อแอปธนาคารที่รองรับ (ใช้ในข้อความ error ของ endpoint) */
export const SUPPORTED_BANK_APPS: BankApp[] = Object.values(BankAppEnum);

/**
 * แปลงค่าจากฟิลด์ `app` ให้เป็น `BankApp` ที่รองรับ
 * (trim + case-insensitive) คืน `null` เมื่อไม่ส่งมา หรือธนาคารนั้นยังไม่รองรับ
 */
export function resolveBankApp(app: unknown): BankApp | null {
  if (typeof app !== 'string') {
    return null;
  }

  const normalized = app.trim().toUpperCase();

  if (!normalized) {
    return null;
  }

  return SUPPORTED_BANK_APPS.find((value) => value === normalized) ?? null;
}

/** `true` เมื่อ `app` เป็นธนาคารที่ระบบมี parser รองรับ */
export function isSupportedBankApp(app: unknown): app is BankApp {
  return resolveBankApp(app) !== null;
}

/**
 * เลือก parser ตามฟิลด์ `app` แล้วแกะยอดเงิน + วันเวลาจาก payload
 * คืน `null` เมื่อธนาคารไม่รองรับ หรือ parser แกะข้อความไม่ได้
 */
export function parseIosNotification(
  payload: IosNotificationBody | null | undefined,
  fallbackTimestamp?: number,
): ParsedKBankMessage | null {
  const bankApp = resolveBankApp(payload?.app);

  if (!bankApp) {
    return null;
  }

  return BANK_NOTIFICATION_PARSERS[bankApp](payload, fallbackTimestamp);
}
