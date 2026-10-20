import { addMonthsClamped } from './datetime.util';

describe('addMonthsClamped', () => {
  it('adds one month while keeping the same day and time', () => {
    const result = addMonthsClamped(
      new Date('2026-01-15T10:30:45.000Z'),
      1,
    );

    expect(result.toISOString()).toBe('2026-02-15T10:30:45.000Z');
  });

  it('clamps January 31 to February 28 in a non-leap year', () => {
    const result = addMonthsClamped(
      new Date('2026-01-31T00:00:00.000Z'),
      1,
    );

    expect(result.toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });

  it('clamps January 31 to February 29 in a leap year', () => {
    const result = addMonthsClamped(
      new Date('2028-01-31T00:00:00.000Z'),
      1,
    );

    expect(result.toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });

  it('clamps March 31 to April 30', () => {
    const result = addMonthsClamped(
      new Date('2026-03-31T05:00:00.000Z'),
      1,
    );

    expect(result.toISOString()).toBe('2026-04-30T05:00:00.000Z');
  });

  it('supports billing cycles longer than one month', () => {
    const result = addMonthsClamped(
      new Date('2026-01-31T00:00:00.000Z'),
      3,
    );

    expect(result.toISOString()).toBe('2026-04-30T00:00:00.000Z');
  });

  it('does not jump across a month for a 12-month cycle', () => {
    const result = addMonthsClamped(
      new Date('2028-02-29T12:00:00.000Z'),
      12,
    );

    expect(result.toISOString()).toBe('2029-02-28T12:00:00.000Z');
  });

  it('crosses the year boundary correctly', () => {
    const result = addMonthsClamped(
      new Date('2026-12-31T23:59:59.000Z'),
      2,
    );

    expect(result.toISOString()).toBe('2027-02-28T23:59:59.000Z');
  });

  it('returns the same instant when adding zero months', () => {
    const date = new Date('2026-10-20T08:00:00.000Z');

    expect(addMonthsClamped(date, 0).toISOString()).toBe(date.toISOString());
  });
});
