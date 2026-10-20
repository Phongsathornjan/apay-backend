import { IsOptional, IsUUID } from 'class-validator';

export class RenewSubscriptionDto {
  @IsOptional()
  @IsUUID()
  package_id?: string;
}
