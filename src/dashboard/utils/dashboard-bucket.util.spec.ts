import { BadRequestException } from '@nestjs/common';
import {
  formatBucketLabel,
  generateBuckets,
  resolveDashboardRange,
  startOfBangkokBucket,
} from './dashboard-bucket.util';

describe('dashboard-bucket.util', () => {
  const fixedNow = new Date('2026-10-20T10:00:00.000Z'); // 17:00 Bangkok

  describe('resolveDashboardRange', () => {
    it('resolves default 30-day range when from/to are omitted', () => {
      const range = resolveDashboardRange(undefined, undefined, 'day', fixedNow);

      expect(range.to.toISOString()).toBe('2026-10-20T10:00:00.000Z');
      expect(range.from.toISOString()).toBe('2026-09-20T10:00:00.000Z');
      expect(range.interval).toBe('day');
    });

    it('throws BadRequestException when from is later than to', () => {
      expect(() =>
        resolveDashboardRange(
          '2026-10-21T00:00:00.000Z',
          '2026-10-20T00:00:00.000Z',
          'day',
          fixedNow,
        ),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException when range exceeds 365 days', () => {
      expect(() =>
        resolveDashboardRange(
          '2025-10-01T00:00:00.000Z',
          '2026-10-20T00:00:00.000Z',
          'day',
          fixedNow,
        ),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException when hourly interval exceeds 31 days', () => {
      expect(() =>
        resolveDashboardRange(
          '2026-09-01T00:00:00.000Z',
          '2026-10-20T00:00:00.000Z',
          'hour',
          fixedNow,
        ),
      ).toThrow(BadRequestException);
    });

    it('allows hourly interval within 31 days', () => {
      const range = resolveDashboardRange(
        '2026-10-01T00:00:00.000Z',
        '2026-10-05T00:00:00.000Z',
        'hour',
        fixedNow,
      );

      expect(range.interval).toBe('hour');
    });
  });

  describe('startOfBangkokBucket & generateBuckets', () => {
    it('aligns day bucket to 00:00 Asia/Bangkok (17:00 UTC previous day)', () => {
      // 2026-10-19T17:00:00.000Z == 2026-10-20 00:00:00+07:00
      const input = new Date('2026-10-19T18:30:00.000Z');
      const start = startOfBangkokBucket(input, 'day');

      expect(start.toISOString()).toBe('2026-10-19T17:00:00.000Z');
      expect(formatBucketLabel(start, 'day')).toBe('20 Oct');
    });

    it('generates half-open day buckets [from, to) without duplicating end boundary', () => {
      // Exact 3 Bangkok days: Oct 20 00:00 TH -> Oct 23 00:00 TH
      const from = new Date('2026-10-19T17:00:00.000Z');
      const to = new Date('2026-10-22T17:00:00.000Z');

      const buckets = generateBuckets(from, to, 'day');

      expect(buckets).toHaveLength(3);
      expect(buckets.map((b) => formatBucketLabel(b, 'day'))).toEqual([
        '20 Oct',
        '21 Oct',
        '22 Oct',
      ]);
    });

    it('generates hourly buckets and formats HH:mm in Bangkok time', () => {
      // 07:00 UTC = 14:00 Bangkok
      const from = new Date('2026-10-20T07:15:00.000Z');
      const to = new Date('2026-10-20T10:00:00.000Z');

      const buckets = generateBuckets(from, to, 'hour');

      expect(buckets).toHaveLength(3);
      expect(buckets.map((b) => formatBucketLabel(b, 'hour'))).toEqual([
        '14:00',
        '15:00',
        '16:00',
      ]);
    });

    it('returns empty array when from >= to', () => {
      const date = new Date('2026-10-20T00:00:00.000Z');
      expect(generateBuckets(date, date, 'day')).toEqual([]);
    });
  });
});
