import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GetTokenDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  api_key?: string;
}
