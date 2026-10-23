/**
 * ทิศทางการเรียงลำดับของรายการ (`?sort_order=`)
 */
export enum SortOrderEnum {
  ASC = 'asc',
  DESC = 'desc',
}

/** Union type ของค่า query parameter `sort_order` */
export type SortOrder = `${SortOrderEnum}`;
