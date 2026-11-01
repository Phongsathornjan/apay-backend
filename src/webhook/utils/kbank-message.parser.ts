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

/**
 * ชื่อเดือนไทยแบบเต็ม/ย่อ ใช้แปลง "1 พ.ย. 69" (รูปแบบแจ้งเตือนของแอป KBank)
 * เป็นเลขเดือน — จุดในชื่อย่อเป็น optional จึงรองรับทั้ง "พ.ย." และ "พย"
 */
const THAI_MONTH_ALIASES: Array<[string, number]> = [
  ['มกราคม', 1],
  ['ม.ค.', 1],
  ['กุมภาพันธ์', 2],
  ['ก.พ.', 2],
  ['มีนาคม', 3],
  ['มี.ค.', 3],
  ['เมษายน', 4],
  ['เม.ย.', 4],
  ['พฤษภาคม', 5],
  ['พ.ค.', 5],
  ['มิถุนายน', 6],
  ['มิ.ย.', 6],
  ['กรกฎาคม', 7],
  ['ก.ค.', 7],
  ['สิงหาคม', 8],
  ['ส.ค.', 8],
  ['กันยายน', 9],
  ['ก.ย.', 9],
  ['ตุลาคม', 10],
  ['ต.ค.', 10],
  ['พฤศจิกายน', 11],
  ['พ.ย.', 11],
  ['ธันวาคม', 12],
  ['ธ.ค.', 12],
];

const THAI_MONTH_LOOKUP = new Map<string, number>(
  THAI_MONTH_ALIASES.map(([name, month]) => [name.replace(/\./g, ''), month]),
);

const THAI_MONTH_PATTERN = THAI_MONTH_ALIASES.map(([name]) =>
  name.replace(/\./g, '\\.?'),
).join('|');

const THAI_DATE_REGEX = new RegExp(
  `(\\d{1,2})\\s*(${THAI_MONTH_PATTERN})\\s*(\\d{2,4})`,
);

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
  const timeMatch = TIME_REGEX.exec(text);
  const hour = timeMatch ? Number(timeMatch[1]) : 0;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;

  // รูปแบบที่ 1: "18/10/69" (แจ้งเตือนผ่าน LINE OA)
  const dateMatch = DATE_REGEX.exec(text);

  if (dateMatch) {
    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const year = convertBuddhistYearToCE(Number(dateMatch[3]));
    const transferTime = bangkokDateTimeToUtc(year, month, day, hour, minute);

    if (!Number.isNaN(transferTime.getTime())) {
      return {
        dateStr: getBangkokParts(transferTime).dateStr,
        transferTime,
      };
    }
  }

  // รูปแบบที่ 2: "1 พ.ย. 69" (แจ้งเตือนจากแอป KBank ที่ส่งผ่าน iOS Shortcut)
  const thaiDateMatch = THAI_DATE_REGEX.exec(text);

  if (thaiDateMatch) {
    const day = Number(thaiDateMatch[1]);
    const month = THAI_MONTH_LOOKUP.get(thaiDateMatch[2].replace(/\./g, ''));
    const year = convertBuddhistYearToCE(Number(thaiDateMatch[3]));

    if (month) {
      const transferTime = bangkokDateTimeToUtc(year, month, day, hour, minute);

      if (!Number.isNaN(transferTime.getTime())) {
        return {
          dateStr: getBangkokParts(transferTime).dateStr,
          transferTime,
        };
      }
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
 * แกะยอดเงิน วันเวลา โอนจากข้อความแจ้งเตือน KBank (ทั้งที่ส่งมาทาง LINE OA
 * และที่ส่งต่อมาจากแอป KBank ผ่าน iOS Shortcut)
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
