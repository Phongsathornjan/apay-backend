export type UserRole = 'admin' | 'business';

/**
 * โครงสร้างข้อมูลผู้ใช้ที่ถูกแนบมากับ `req.user` หลังผ่าน JwtStrategy.validate()
 */
export interface AuthUser {
  userId: string;
  username: string;
  role: UserRole;
  businessId: string | null;
}
