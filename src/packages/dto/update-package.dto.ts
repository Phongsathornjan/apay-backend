import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdatePackageDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  max_api_keys?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  quota_limit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  rate_limit_per_hour?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  billing_cycle_months?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
