import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { BusinessSubscriptionStatus } from '../../subscriptions/entities/business-subscription.entity';
import { DashboardRangeQueryDto } from './dashboard-range-query.dto';

export type AdminBusinessesSortBy =
  | 'gmv'
  | 'qr_created'
  | 'qr_paid'
  | 'quota_used'
  | 'current_period_end'
  | 'created_at';

export type SortOrder = 'asc' | 'desc';

export class AdminBusinessesQueryDto extends DashboardRangeQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;

  @IsOptional()
  @IsUUID()
  package_id?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'PAST_DUE', 'CANCELLED'])
  status?: BusinessSubscriptionStatus;

  @IsOptional()
  @IsIn([
    'gmv',
    'qr_created',
    'qr_paid',
    'quota_used',
    'current_period_end',
    'created_at',
  ])
  sort_by?: AdminBusinessesSortBy;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_order?: SortOrder;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
