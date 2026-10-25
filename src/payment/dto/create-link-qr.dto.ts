import { IsOptional, IsUrl, MaxLength } from 'class-validator';

export class CreateLinkQrDto {
  /**
   * ปลายทาง HTTP POST ที่จะได้รับแจ้งเมื่อ QR ผูก LINE ถูกชำระสำเร็จ
   * (event = `line.linked`) ไม่บังคับ — ถ้าไม่ส่ง ระบบจะไม่ยิง callback
   * และฝั่ง client ต้องตรวจสอบสถานะด้วยการ polling เอง
   */
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  redirect_url?: string | null;
}
