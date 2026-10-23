import { durationToSeconds } from './duration.util';

describe('durationToSeconds', () => {
  it('returns fallback when value is undefined or null', () => {
    expect(durationToSeconds(undefined, 900)).toBe(900);
    expect(durationToSeconds(null as unknown as undefined, 900)).toBe(900);
  });

  it('returns numeric values directly', () => {
    expect(durationToSeconds(300, 900)).toBe(300);
  });

  it('parses seconds, minutes, hours, and days', () => {
    expect(durationToSeconds('45s', 900)).toBe(45);
    expect(durationToSeconds('120', 900)).toBe(120);
    expect(durationToSeconds('15m', 900)).toBe(900);
    expect(durationToSeconds('2h', 900)).toBe(7200);
    expect(durationToSeconds('7d', 900)).toBe(604800);
  });

  it('returns fallback for malformed duration strings', () => {
    expect(durationToSeconds('invalid', 900)).toBe(900);
    expect(durationToSeconds('10w', 900)).toBe(900);
  });
});
