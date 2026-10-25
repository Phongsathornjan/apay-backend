import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsUrl,
  Min,
} from 'class-validator';

export class CreateQrDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsUrl({ require_tld: false })
  @IsNotEmpty()
  redirect_url: string;

  /**
   * `true` = สร้าง QR แบบไม่มีเศษสตางค์ (ยอดลงท้าย `.00` เช่น `99.00`)
   * โดยไม่จอง `decimal_ref` — ใช้เมื่อต้องการให้ยอดโอนตรงกับ `amount` เป๊ะ ๆ
   * (ค่าเริ่มต้น `false` = จอง `decimal_ref` 0.01–0.99 ตามปกติ)
   */
  @IsOptional()
  @IsBoolean()
  zero_decimal?: boolean;
}
