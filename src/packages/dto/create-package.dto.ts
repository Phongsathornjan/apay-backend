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

export class CreatePackageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsInt()
  @Min(1)
  max_api_keys: number;

  @IsInt()
  @Min(1)
  quota_limit: number;

  @IsInt()
  @Min(1)
  rate_limit_per_hour: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  billing_cycle_months?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
