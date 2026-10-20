import { IsUUID } from 'class-validator';

export class AssignSubscriptionDto {
  @IsUUID()
  business_id: string;

  @IsUUID()
  package_id: string;
}
