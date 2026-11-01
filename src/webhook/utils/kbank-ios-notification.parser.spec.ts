import { parseKbankIosNotification } from './kbank-ios-notification.parser';

describe('parseKbankIosNotification', () => {
  it('parses amount and datetime from the KBank app notification body', () => {
    const result = parseKbankIosNotification({
      app: 'K_PLUS',
      title: 'รายการเงินเข้า',
      body: 'บัญชี xxx-x-x8583-x  จำนวนเงิน 1.00 บาท  วันที่ 1 พ.ย. 69  22:57 น.',
    });

    expect(result).not.toBeNull();
    expect(result?.amount).toBe('1.00');
    expect(result?.dateStr).toBe('20261101');
    expect(result?.transferTime.toISOString()).toBe('2026-11-01T15:57:00.000Z');
    expect(result?.datetimeStr).toBe('20261101 22:57');
  });

  it('parses the notification without a title', () => {
    const result = parseKbankIosNotification({
      body: 'จำนวนเงิน 1,234.50 บาท วันที่ 20/10/69 15:31 น.',
    });

    expect(result?.amount).toBe('1234.50');
    expect(result?.dateStr).toBe('20261020');
  });

  it('returns null for a money-out notification', () => {
    const result = parseKbankIosNotification({
      app: 'K_PLUS',
      title: 'รายการเงินออก',
      body: 'บัญชี xxx-x-x8583-x  จำนวนเงิน 1.00 บาท  วันที่ 1 พ.ย. 69  22:57 น.',
    });

    expect(result).toBeNull();
  });

  it('returns null when there is no body text', () => {
    expect(parseKbankIosNotification({ title: 'รายการเงินเข้า' })).toBeNull();
    expect(parseKbankIosNotification(null)).toBeNull();
    expect(parseKbankIosNotification({ body: '   ' })).toBeNull();
  });

  it('returns null when the body has no decimal amount', () => {
    const result = parseKbankIosNotification({
      title: 'รายการเงินเข้า',
      body: 'มียอดเงินเข้าใหม่',
    });

    expect(result).toBeNull();
  });

  it('uses the payload timestamp when the body has no date', () => {
    const timestamp = 1793554620000;

    const result = parseKbankIosNotification({
      title: 'รายการเงินเข้า',
      body: 'จำนวนเงิน 75.50 บาท',
      timestamp,
    });

    expect(result?.amount).toBe('75.50');
    expect(result?.transferTime.getTime()).toBe(timestamp);
  });

  it('accepts an ISO string timestamp as the fallback time', () => {
    const result = parseKbankIosNotification({
      body: 'จำนวนเงิน 75.50 บาท',
      timestamp: '2026-11-01T15:57:00.000Z',
    });

    expect(result?.transferTime.toISOString()).toBe('2026-11-01T15:57:00.000Z');
  });
});
