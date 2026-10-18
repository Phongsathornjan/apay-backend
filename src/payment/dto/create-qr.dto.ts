import { IsNotEmpty, IsNumber, IsUrl, Min } from 'class-validator';

export class CreateQrDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsUrl({ require_tld: false })
  @IsNotEmpty()
  redirect_url: string;
}
