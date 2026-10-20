import {
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
  @IsUUID()
  package_id?: string;
}
