import type { UserRole } from '../../enums/role.enum';

export type { UserRole };

/**
 * โครงสร้างข้อมูลผู้ใช้ที่ถูกแนบมากับ `req.user` หลังผ่าน JwtStrategy.validate()
 */
export interface AuthUser {
  userId: string;
  username: string;
  role: UserRole;
  businessId: string | null;
  /**
   * มีค่าเมื่อ Token ถูกออกจากการแลก API Key (`POST /auth/token`)
   * ใช้ผูก `payment_orders.api_key_id` และบันทึก `api_key_usage_logs`
   */
  apiKeyId?: string | null;
}
