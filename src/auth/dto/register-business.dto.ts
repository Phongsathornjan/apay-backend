import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterBusinessDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  username: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  business_name: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @Matches(/^(\d{10}|\d{13})$/, {
    message: 'promptpay_id must be a 10-digit phone number or 13-digit id',
  })
  promptpay_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  line_destination?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  line_user_id?: string;

  @IsOptional()
  @IsUUID()
  package_id?: string;
}
