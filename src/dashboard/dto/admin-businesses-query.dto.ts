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
import {
  AdminBusinessesSortByEnum,
  type AdminBusinessesSortBy,
  BusinessSubscriptionStatusEnum,
  type BusinessSubscriptionStatus,
  SortOrderEnum,
  type SortOrder,
} from '../../enums';
import { DashboardRangeQueryDto } from './dashboard-range-query.dto';

export type { AdminBusinessesSortBy, SortOrder };

export class AdminBusinessesQueryDto extends DashboardRangeQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;

  @IsOptional()
  @IsUUID()
  package_id?: string;

  @IsOptional()
  @IsIn(Object.values(BusinessSubscriptionStatusEnum))
  status?: BusinessSubscriptionStatus;

  @IsOptional()
  @IsIn(Object.values(AdminBusinessesSortByEnum))
  sort_by?: AdminBusinessesSortBy;

  @IsOptional()
  @IsIn(Object.values(SortOrderEnum))
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
