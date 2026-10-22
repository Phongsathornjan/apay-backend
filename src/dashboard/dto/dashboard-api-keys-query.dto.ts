import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { DashboardRangeQueryDto } from './dashboard-range-query.dto';
import type { DashboardUsageMetric } from './dashboard-usage-query.dto';

export class DashboardApiKeysQueryDto extends DashboardRangeQueryDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    return String(value).toLowerCase() === 'true';
  })
  @IsBoolean()
  include_deleted?: boolean;

  @IsOptional()
  @IsIn(['qr_created', 'qr_paid', 'quota_deducted'])
  metric?: DashboardUsageMetric;

  @IsOptional()
  @IsUUID()
  api_key_id?: string;
}
