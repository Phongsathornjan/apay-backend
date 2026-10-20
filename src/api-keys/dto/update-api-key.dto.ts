import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateApiKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
