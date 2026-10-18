import {
  bangkokDateTimeToUtc,
  convertBuddhistYearToCE,
  getBangkokParts,
} from '../../common/utils/datetime.util';

export interface ParsedKBankMessage {
  /** ยอดเงินทศนิยม 2 ตำแหน่ง เช่น "100.25" */
  amount: string;
  /** วันที่ในรูปแบบ YYYYMMDD ตามเวลาไทย เช่น "20261018" */
  dateStr: string;
  /** เวลาที่โอน (Date) ใช้สำหรับตรวจสอบว่าอยู่ในช่วงอายุของ Order */
  transferTime: Date;
  /** ข้อความวันเวลาแบบอ่านง่าย เช่น "20261018 14:32" */
  datetimeStr: string;
}

const AMOUNT_KEYWORD_REGEX =
  /(?:จำนวนเงิน|จำนวน|เงินเข้า|รับโอนเงิน|รับโอน|รับเงิน)\s*([0-9][0-9,]*\.\d{2})\s*(?:บาท|THB)?/i;

const AMOUNT_FALLBACK_REGEX = /([0-9][0-9,]*\.\d{2})/;

const AMOUNT_CONTEXT_KEYWORDS = ['เงินเข้า', 'รับโอน', 'รับเงิน', 'โอนเข้า'];

const DATE_REGEX = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/;

const TIME_REGEX = /(\d{1,2}):(\d{2})/;

function extractAmount(text: string): string | null {
  const keywordMatch = AMOUNT_KEYWORD_REGEX.exec(text);
  let rawAmount = keywordMatch?.[1];

  if (!rawAmount && AMOUNT_CONTEXT_KEYWORDS.some((word) => text.includes(word))) {
    const fallbackMatch = AMOUNT_FALLBACK_REGEX.exec(text);
    rawAmount = fallbackMatch?.[1];
  }

  if (!rawAmount) {
    return null;
  }

  const normalized = Number(rawAmount.replace(/,/g, ''));

  if (Number.isNaN(normalized)) {
    return null;
  }

  return normalized.toFixed(2);
}

function buildDatetimeStr(date: Date): string {
  const { dateStr, timeStr } = getBangkokParts(date);

  return `${dateStr} ${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}`;
}

function extractDateTime(
  text: string,
  fallbackTimestamp?: number,
): { dateStr: string; transferTime: Date } {
  const dateMatch = DATE_REGEX.exec(text);
  const timeMatch = TIME_REGEX.exec(text);

  if (dateMatch) {
    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const year = convertBuddhistYearToCE(Number(dateMatch[3]));
    const hour = timeMatch ? Number(timeMatch[1]) : 0;
    const minute = timeMatch ? Number(timeMatch[2]) : 0;

    const transferTime = bangkokDateTimeToUtc(year, month, day, hour, minute);

    if (!Number.isNaN(transferTime.getTime())) {
      return {
        dateStr: getBangkokParts(transferTime).dateStr,
        transferTime,
      };
    }
  }

  const fallbackDate =
    fallbackTimestamp !== undefined ? new Date(fallbackTimestamp) : new Date();

  return {
    dateStr: getBangkokParts(fallbackDate).dateStr,
    transferTime: fallbackDate,
  };
}

/**
 * แกะยอดเงิน วันเวลา โอนจากข้อความแจ้งเตือน KBank ที่ส่งมาทาง LINE OA
 * คืนค่า null หากไม่พบยอดเงินทศนิยม 2 ตำแหน่งในข้อความ
 */
export function parseKBankMessage(
  text: string,
  fallbackTimestamp?: number,
): ParsedKBankMessage | null {
  if (!text) {
    return null;
  }

  const amount = extractAmount(text);

  if (!amount) {
    return null;
  }

  const { dateStr, transferTime } = extractDateTime(text, fallbackTimestamp);

  return {
    amount,
    dateStr,
    transferTime,
    datetimeStr: buildDatetimeStr(transferTime),
  };
}
