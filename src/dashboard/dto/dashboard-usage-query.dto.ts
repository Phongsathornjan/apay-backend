import { IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  DashboardUsageMetricEnum,
  type DashboardUsageMetric,
} from '../../enums/dashboard-usage-metric.enum';
import { DashboardRangeQueryDto } from './dashboard-range-query.dto';

export type { DashboardUsageMetric };

export class DashboardUsageQueryDto extends DashboardRangeQueryDto {
  @IsOptional()
  @IsIn(Object.values(DashboardUsageMetricEnum))
  metric?: DashboardUsageMetric;

  @IsOptional()
  @IsUUID()
  api_key_id?: string;
}
