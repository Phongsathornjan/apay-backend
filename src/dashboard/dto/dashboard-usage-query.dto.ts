import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { DashboardRangeQueryDto } from './dashboard-range-query.dto';

export type DashboardUsageMetric = 'qr_created' | 'qr_paid' | 'quota_deducted';

export class DashboardUsageQueryDto extends DashboardRangeQueryDto {
  @IsOptional()
  @IsIn(['qr_created', 'qr_paid', 'quota_deducted'])
  metric?: DashboardUsageMetric;

  @IsOptional()
  @IsUUID()
  api_key_id?: string;
}
