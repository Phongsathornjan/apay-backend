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
