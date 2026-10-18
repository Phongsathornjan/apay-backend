/**
 * Schema ส่วนตัวสำหรับตารางของระบบ APay
 *
 * ใช้ schema แยกจาก `public` เพื่อไม่ให้ถูก expose ผ่าน PostgREST/Supabase REST API
 * (ตารางใน `public` จะถูกเปิดให้ role `anon`/`authenticated` เข้าถึงได้โดยอัตโนมัติ)
 */
export const DB_SCHEMA = 'apay';
