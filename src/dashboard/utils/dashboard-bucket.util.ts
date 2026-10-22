import { BadRequestException } from '@nestjs/common';
import {
  bangkokDateTimeToUtc,
  getBangkokParts,
} from '../../common/utils/datetime.util';
import { DashboardInterval, DashboardRange } from '../types/dashboard.types';

const BANGKOK_TIME_ZONE = 'Asia/Bangkok';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 365;
const MAX_HOUR_RANGE_DAYS = 31;
const MAX_BUCKETS = 744;

const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: BANGKOK_TIME_ZONE,
  day: '2-digit',
  month: 'short',
});

const HOUR_LABEL_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: BANGKOK_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function startOfBangkokBucket(
  date: Date,
  interval: DashboardInterval,
): Date {
  const { dateStr, timeStr } = getBangkokParts(date);
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(4, 6));
  const day = Number(dateStr.slice(6, 8));
  const hour = interval === 'hour' ? Number(timeStr.slice(0, 2)) : 0;

  return bangkokDateTimeToUtc(year, month, day, hour, 0, 0);
}

export function generateBuckets(
  from: Date,
  to: Date,
  interval: DashboardInterval,
): Date[] {
  if (from.getTime() >= to.getTime()) {
    return [];
  }

  const stepMs = interval === 'hour' ? HOUR_MS : DAY_MS;
  const start = startOfBangkokBucket(from, interval);
  const buckets: Date[] = [];

  for (
    let cursor = start.getTime();
    cursor < to.getTime();
    cursor += stepMs
  ) {
    buckets.push(new Date(cursor));
  }

  return buckets;
}

export function formatBucketLabel(
  bucket: Date,
  interval: DashboardInterval,
): string {
  if (interval === 'hour') {
    return HOUR_LABEL_FORMATTER.format(bucket);
  }

  return DAY_LABEL_FORMATTER.format(bucket);
}

export function resolveDashboardRange(
  from?: string,
  to?: string,
  interval: DashboardInterval = 'day',
  now: Date = new Date(),
): { from: Date; to: Date; interval: DashboardInterval } {
  const resolvedTo = to ? new Date(to) : new Date(now.getTime());
  const resolvedFrom = from
    ? new Date(from)
    : new Date(resolvedTo.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);

  if (Number.isNaN(resolvedFrom.getTime()) || Number.isNaN(resolvedTo.getTime())) {
    throw new BadRequestException('Invalid date range');
  }

  if (resolvedFrom.getTime() > resolvedTo.getTime()) {
    throw new BadRequestException('"from" must not be later than "to"');
  }

  const spanMs = resolvedTo.getTime() - resolvedFrom.getTime();

  if (spanMs > MAX_RANGE_DAYS * DAY_MS) {
    throw new BadRequestException(
      `Date range cannot exceed ${MAX_RANGE_DAYS} days`,
    );
  }

  if (interval === 'hour' && spanMs > MAX_HOUR_RANGE_DAYS * DAY_MS) {
    throw new BadRequestException(
      `Hourly interval cannot exceed ${MAX_HOUR_RANGE_DAYS} days`,
    );
  }

  const buckets = generateBuckets(resolvedFrom, resolvedTo, interval);
  if (buckets.length > MAX_BUCKETS) {
    throw new BadRequestException(
      `Requested range exceeds maximum of ${MAX_BUCKETS} buckets`,
    );
  }

  return {
    from: resolvedFrom,
    to: resolvedTo,
    interval,
  };
}

export function toDashboardRangeMeta(range: {
  from: Date;
  to: Date;
  interval: DashboardInterval;
}): DashboardRange {
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    interval: range.interval,
    timezone: BANGKOK_TIME_ZONE,
  };
}
