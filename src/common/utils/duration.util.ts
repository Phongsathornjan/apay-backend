/**
 * แปลงระยะเวลาในรูปแบบ string (เช่น "15m", "7d", "3600s") เป็นจำนวนวินาที
 */
export function durationToSeconds(
  value: string | number | undefined,
  fallback: number,
): number {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value === 'number') {
    return value;
  }

  const match = /^(\d+)\s*(s|m|h|d)?$/i.exec(value.trim());

  if (!match) {
    return fallback;
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();

  switch (unit) {
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 60 * 60;
    case 'd':
      return amount * 60 * 60 * 24;
    default:
      return amount;
  }
}
