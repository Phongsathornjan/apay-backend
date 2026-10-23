import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  DashboardIntervalEnum,
  type DashboardInterval,
} from '../../enums/dashboard-interval.enum';

export class DashboardRangeQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsIn(Object.values(DashboardIntervalEnum))
  interval?: DashboardInterval;

  @IsOptional()
  @IsUUID()
  business_id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  hours?: number;
}
