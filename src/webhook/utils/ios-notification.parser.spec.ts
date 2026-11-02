import { BankAppEnum } from '../../enums';
import {
  isSupportedBankApp,
  parseIosNotification,
  resolveBankApp,
  SUPPORTED_BANK_APPS,
} from './ios-notification.parser';

describe('ios-notification parser registry', () => {
  const kbankPayload = {
    app: 'K_PLUS',
    title: 'รายการเงินเข้า',
    body: 'บัญชี xxx-x-x8583-x  จำนวนเงิน 1.00 บาท  วันที่ 1 พ.ย. 69  22:57 น.',
  };

  describe('SUPPORTED_BANK_APPS', () => {
    it('lists every bank app declared in BankAppEnum', () => {
      expect(SUPPORTED_BANK_APPS).toEqual(Object.values(BankAppEnum));
      expect(SUPPORTED_BANK_APPS).toEqual([BankAppEnum.KBANK_K_PLUS]);
    });
  });

  describe('resolveBankApp', () => {
    it('resolves a supported app', () => {
      expect(resolveBankApp('K_PLUS')).toBe(BankAppEnum.KBANK_K_PLUS);
    });

    it('trims and ignores case', () => {
      expect(resolveBankApp('  k_plus ')).toBe(BankAppEnum.KBANK_K_PLUS);
    });

    it('returns null for unsupported banks', () => {
      expect(resolveBankApp('SCB_EASY')).toBeNull();
      expect(resolveBankApp('KPLUS')).toBeNull();
    });

    it('returns null for missing or non-string values', () => {
      expect(resolveBankApp(undefined)).toBeNull();
      expect(resolveBankApp(null)).toBeNull();
      expect(resolveBankApp('   ')).toBeNull();
      expect(resolveBankApp(123)).toBeNull();
      expect(resolveBankApp({ app: 'K_PLUS' })).toBeNull();
    });
  });

  describe('isSupportedBankApp', () => {
    it('accepts supported banks only', () => {
      expect(isSupportedBankApp('K_PLUS')).toBe(true);
      expect(isSupportedBankApp('scb')).toBe(false);
      expect(isSupportedBankApp(undefined)).toBe(false);
    });
  });

  describe('parseIosNotification', () => {
    it('dispatches K_PLUS payloads to the KBank parser', () => {
      const parsed = parseIosNotification(kbankPayload);

      expect(parsed).toEqual(
        expect.objectContaining({
          amount: '1.00',
          dateStr: '20261101',
        }),
      );
    });

    it('returns null for unsupported bank apps', () => {
      expect(
        parseIosNotification({ ...kbankPayload, app: 'SCB_EASY' }),
      ).toBeNull();
      expect(
        parseIosNotification({ ...kbankPayload, app: undefined }),
      ).toBeNull();
    });

    it('returns null when the payload is empty', () => {
      expect(parseIosNotification(undefined)).toBeNull();
      expect(parseIosNotification(null)).toBeNull();
      expect(parseIosNotification({ app: 'K_PLUS' })).toBeNull();
    });

    it('returns null for money-out notifications even from a supported bank', () => {
      expect(
        parseIosNotification({
          app: 'K_PLUS',
          title: 'รายการเงินออก',
          body: 'จำนวนเงิน 1.00 บาท วันที่ 1 พ.ย. 69 22:57 น.',
        }),
      ).toBeNull();
    });
  });
});
