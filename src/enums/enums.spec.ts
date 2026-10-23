import {
  AdminBusinessesSortByEnum,
  ApiKeyUsageActionEnum,
  BusinessSubscriptionStatusEnum,
  DashboardIntervalEnum,
  DashboardUsageMetricEnum,
  PaymentOrderStatusEnum,
  RoleEnum,
  SortOrderEnum,
  WebhookProcessStatusEnum,
} from './index';

/**
 * Enum ในโฟลเดอร์นี้คือ "single source of truth" ของค่าที่ถูกเก็บลง Database
 * และค่าที่รับ/ส่งผ่าน API ดังนั้น test ชุดนี้จึงยึดสัญญา (contract) เป็นหลัก
 * ถ้ามีการเพิ่ม/ลบ/เปลี่ยนค่า enum ต้องอัปเดตทั้ง entity, api-docs.html และ test นี้พร้อมกัน
 */
describe('Domain enums', () => {
  describe('RoleEnum', () => {
    it('matches the roles seeded by DatabaseSeederService', () => {
      expect(Object.values(RoleEnum)).toEqual(['admin', 'business']);
    });

    it('exposes each role as a named member', () => {
      expect(RoleEnum.ADMIN).toBe('admin');
      expect(RoleEnum.BUSINESS).toBe('business');
    });
  });

  describe('Database status enums', () => {
    it('defines every payment_orders.status value', () => {
      expect(Object.values(PaymentOrderStatusEnum)).toEqual([
        'UNVERIFIED',
        'PAID',
        'EXPIRED',
      ]);
    });

    it('defines every business_subscriptions.status value', () => {
      expect(Object.values(BusinessSubscriptionStatusEnum)).toEqual([
        'ACTIVE',
        'PAST_DUE',
        'CANCELLED',
      ]);
    });

    it('defines every webhook_logs.process_status value', () => {
      expect(Object.values(WebhookProcessStatusEnum)).toEqual([
        'MATCHED',
        'NO_MATCH',
        'DUPLICATE',
        'IGNORED',
      ]);
    });

    it('defines every api_key_usage_logs.action value', () => {
      expect(Object.values(ApiKeyUsageActionEnum)).toEqual([
        'QR_CREATED',
        'QR_PAID',
      ]);
    });
  });

  describe('Query enum values', () => {
    it('defines dashboard interval values', () => {
      expect(Object.values(DashboardIntervalEnum)).toEqual(['hour', 'day']);
    });

    it('defines dashboard usage metric values', () => {
      expect(Object.values(DashboardUsageMetricEnum)).toEqual([
        'qr_created',
        'qr_paid',
        'quota_deducted',
      ]);
    });

    it('defines sort order values', () => {
      expect(Object.values(SortOrderEnum)).toEqual(['asc', 'desc']);
    });

    it('defines admin businesses sort_by values', () => {
      expect(Object.values(AdminBusinessesSortByEnum)).toEqual([
        'gmv',
        'qr_created',
        'qr_paid',
        'quota_used',
        'current_period_end',
        'created_at',
      ]);
    });
  });

  describe('Enum invariants', () => {
    const allEnums: Array<[string, object]> = [
      ['RoleEnum', RoleEnum],
      ['PaymentOrderStatusEnum', PaymentOrderStatusEnum],
      ['BusinessSubscriptionStatusEnum', BusinessSubscriptionStatusEnum],
      ['WebhookProcessStatusEnum', WebhookProcessStatusEnum],
      ['ApiKeyUsageActionEnum', ApiKeyUsageActionEnum],
      ['DashboardIntervalEnum', DashboardIntervalEnum],
      ['DashboardUsageMetricEnum', DashboardUsageMetricEnum],
      ['SortOrderEnum', SortOrderEnum],
      ['AdminBusinessesSortByEnum', AdminBusinessesSortByEnum],
    ];

    it('has unique, non-empty values in every enum', () => {
      for (const [name, enumObject] of allEnums) {
        const values = Object.values(enumObject);

        expect(values.length).toBeGreaterThan(0);
        expect({ enum: name, values: [...new Set(values)] }).toEqual({
          enum: name,
          values,
        });

        for (const value of values) {
          expect(typeof value).toBe('string');
          expect(value).not.toBe('');
        }
      }

      expect(allEnums.map(([name]) => name)).toHaveLength(9);
    });

    it('keeps database enum keys identical to their stored values', () => {
      const databaseEnums: Array<[string, object]> = [
        ['PaymentOrderStatusEnum', PaymentOrderStatusEnum],
        ['BusinessSubscriptionStatusEnum', BusinessSubscriptionStatusEnum],
        ['WebhookProcessStatusEnum', WebhookProcessStatusEnum],
        ['ApiKeyUsageActionEnum', ApiKeyUsageActionEnum],
      ];

      for (const [name, enumObject] of databaseEnums) {
        for (const [key, value] of Object.entries(enumObject)) {
          expect({ enum: name, key, value }).toEqual({
            enum: name,
            key,
            value: key,
          });
        }
      }
    });

    it('uses lowercase values for user-facing query params', () => {
      for (const enumObject of [
        DashboardIntervalEnum,
        DashboardUsageMetricEnum,
        SortOrderEnum,
        AdminBusinessesSortByEnum,
      ]) {
        for (const value of Object.values(enumObject)) {
          expect(value).toBe(value.toLowerCase());
        }
      }
    });
  });
});
