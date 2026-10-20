export interface BangkokParts {
  dateStr: string; // YYYYMMDD
  timeStr: string; // HHmmss
}

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';

/**
 * แปลง Date (UTC) ให้เป็นส่วนประกอบวันที่/เวลาในโซนเวลาไทย (UTC+7)
 */
export function getBangkokParts(date: Date): BangkokParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const lookup = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '00';

  const year = lookup('year');
  const month = lookup('month');
  const day = lookup('day');
  const hour = lookup('hour');
  const minute = lookup('minute');
  const second = lookup('second');

  return {
    dateStr: `${year}${month}${day}`,
    timeStr: `${hour}${minute}${second}`,
  };
}

/**
 * แปลงปี พ.ศ. (Buddhist Era) เป็น ค.ศ. (CE)
 * รองรับทั้งแบบ 2 หลัก (เช่น 69 -> 2026) และ 4 หลัก (เช่น 2569 -> 2026)
 */
export function convertBuddhistYearToCE(rawYear: number): number {
  if (rawYear >= 2400) {
    return rawYear - 543;
  }

  if (rawYear < 100) {
    return rawYear + 2500 - 543;
  }

  return rawYear;
}

/**
 * สร้าง Date (UTC) จากวันเวลาในโซนเวลาไทย (UTC+7)
 */
export function bangkokDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date {
  const padded = (value: number, length = 2): string =>
    String(value).padStart(length, '0');

  const iso = `${padded(year, 4)}-${padded(month)}-${padded(day)}T${padded(
    hour,
  )}:${padded(minute)}:${padded(second)}+07:00`;

  return new Date(iso);
}

/**
 * บวกจำนวนเดือนโดยรักษาวันและเวลาเดิม (ใช้คำนวณวันครบรอบบิล)
 * หากเดือนปลายทางมีจำนวนวันน้อยกว่า (เช่น 31 ม.ค. → ก.พ.) จะ Clamp
 * เป็นวันสุดท้ายของเดือนปลายทาง (28/29/30) แทนการกระโดดข้ามเดือน
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const originalDay = result.getUTCDate();

  // ตั้งเป็นวันที่ 1 ก่อนเพื่อป้องกันการ Rollover ระหว่างเปลี่ยนเดือน
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);

  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();

  result.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));

  return result;
}
