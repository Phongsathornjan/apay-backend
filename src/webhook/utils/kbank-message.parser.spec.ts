import { parseKBankMessage } from './kbank-message.parser';

describe('parseKBankMessage', () => {
  it('parses a full KBank money-in notification in Thai', () => {
    const text = [
      'รายการเงินเข้า',
      'บัญชี xxx-x-x1234-x',
      'จำนวน 100.25 บาท',
      'วันที่ 18/10/69 เวลา 14:32 น.',
    ].join('\n');

    const result = parseKBankMessage(text);

    expect(result).not.toBeNull();
    expect(result?.amount).toBe('100.25');
    expect(result?.dateStr).toBe('20261018');
    expect(result?.transferTime.toISOString()).toBe('2026-10-18T07:32:00.000Z');
  });

  it('parses an amount with thousands separators', () => {
    const result = parseKBankMessage(
      'รับโอนเงิน จำนวน 1,234.50 บาท วันที่ 01/01/2569 เวลา 09:05 น.',
    );

    expect(result?.amount).toBe('1234.50');
    expect(result?.dateStr).toBe('20260101');
    expect(result?.transferTime.toISOString()).toBe('2026-01-01T02:05:00.000Z');
  });

  it('parses a Thai month name date from the KBank app notification', () => {
    const result = parseKBankMessage(
      'บัญชี xxx-x-x8583-x  จำนวนเงิน 1.00 บาท  วันที่ 1 พ.ย. 69  22:57 น.',
    );

    expect(result?.amount).toBe('1.00');
    expect(result?.dateStr).toBe('20261101');
    expect(result?.transferTime.toISOString()).toBe('2026-11-01T15:57:00.000Z');
    expect(result?.datetimeStr).toBe('20261101 22:57');
  });

  it('parses a full Thai month name and a 4-digit Buddhist year', () => {
    const result = parseKBankMessage(
      'จำนวนเงิน 250.00 บาท วันที่ 31 ธันวาคม 2569 08:05 น.',
    );

    expect(result?.amount).toBe('250.00');
    expect(result?.dateStr).toBe('20261231');
    expect(result?.transferTime.toISOString()).toBe('2026-12-31T01:05:00.000Z');
  });

  it('parses a Thai month abbreviation without dots', () => {
    const result = parseKBankMessage('จำนวนเงิน 45.75 บาท วันที่ 9 มีค 69 13:40 น.');

    expect(result?.amount).toBe('45.75');
    expect(result?.dateStr).toBe('20260309');
    expect(result?.transferTime.toISOString()).toBe('2026-03-09T06:40:00.000Z');
  });

  it('falls back to a generic decimal when only context keywords are present', () => {
    const result = parseKBankMessage('โอนเข้า 500.00 บาท');

    expect(result?.amount).toBe('500.00');
  });

  it('uses the event timestamp when the text has no date', () => {
    const timestamp = 1792308720000;

    const result = parseKBankMessage('เงินเข้า 75.50 บาท', timestamp);

    expect(result?.amount).toBe('75.50');
    expect(result?.transferTime.getTime()).toBe(timestamp);
  });

  it('returns null when there is no decimal amount in the text', () => {
    const result = parseKBankMessage('สวัสดีครับ');

    expect(result).toBeNull();
  });
});
