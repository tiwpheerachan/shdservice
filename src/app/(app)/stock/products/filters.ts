/** the product list's filter bar — pure, shared by the page and its server render (page.tsx) */

/** stock: "" = ทั้งหมด · in = มีของเกิน 3 ชิ้น · low = ใกล้หมด 1–3 · out = หมด (≤ 0) — same buckets as the KPI cards */
export type StockFilter = '' | 'in' | 'low' | 'out';
export type Filters = {
  sysCode: string;
  mfgCode: string;
  name: string;
  status: string;
  brand: string;
  model: string;
  category: string;
  creator: string;
  date: string;
  stock: StockFilter;
};
/** the list starts on ACTIVE products (INACTIVE on request, DELETED never) — also what ล้างค่า goes back to */
export const NO_FILTER: Filters = {
  sysCode: '',
  mfgCode: '',
  name: '',
  status: 'Active',
  brand: '',
  model: '',
  category: '',
  creator: '',
  date: '',
  stock: '',
};
