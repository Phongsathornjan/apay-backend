/**
 * บทบาทผู้ใช้ในระบบ (ค่าต้องตรงกับ `roles.name` ที่ `DatabaseSeederService` สร้างไว้)
 * ใช้ร่วมกันระหว่าง JWT payload, `@Roles()` decorator และ `RoleGuard`
 */
export enum RoleEnum {
  /** ผู้ดูแลระบบ (platform admin) — จัดการ package, subscription และ business ทั้งหมด */
  ADMIN = 'admin',
  /** บัญชีร้านค้า (merchant/business) — เห็นข้อมูลได้เฉพาะ business ของตัวเอง */
  BUSINESS = 'business',
}

/**
 * Union type ของชื่อ Role (คงรูปแบบเดิม `'admin' | 'business'`)
 * ใช้เป็น type ของ `AuthUser.role`, JWT payload และพารามิเตอร์ของ `@Roles(...)`
 */
export type UserRole = `${RoleEnum}`;
