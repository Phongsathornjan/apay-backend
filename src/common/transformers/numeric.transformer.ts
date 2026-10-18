import { ValueTransformer } from 'typeorm';

/**
 * Postgres `numeric` จะถูกส่งกลับมาเป็น string ผ่าน pg driver
 * Transformer นี้แปลงค่าเป็น number เพื่อให้ Response ออกมาเป็นตัวเลขตามที่ต้องการ
 */
export const numericTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | number | null) => {
    if (value === null || value === undefined) {
      return null;
    }

    return typeof value === 'number' ? value : Number(value);
  },
};
