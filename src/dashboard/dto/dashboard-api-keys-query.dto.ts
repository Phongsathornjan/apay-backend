import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  DashboardUsageMetricEnum,
  type DashboardUsageMetric,
} from '../../enums/dashboard-usage-metric.enum';
import { DashboardRangeQueryDto } from './dashboard-range-query.dto';

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
  @IsIn(Object.values(DashboardUsageMetricEnum))
  metric?: DashboardUsageMetric;

  @IsOptional()
  @IsUUID()
  api_key_id?: string;
}
