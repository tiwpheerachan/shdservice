/** pure: shared by the page and its server render */

export type Filters = {
  no: string;
  customer: string;
  from: string;
  to: string;
  code: string;
  sales: string;
  approve: string;
  /** '1' = แสดงใบที่ยกเลิก (cancelled orders are hidden by default) */
  cancelled: string;
};
export const NO_FILTER: Filters = {
  no: '',
  customer: '',
  from: '',
  to: '',
  code: '',
  sales: '',
  approve: '',
  cancelled: '',
};
export const WAITING = 'รออนุมัติ'; // approve_status 2 (its approve_name_th — the list filters by that name)
export const listParams = (f: Filters) => ({
  no: f.no,
  customer: f.customer,
  code: f.code,
  from: f.from,
  to: f.to,
  sales: f.sales,
  approve: f.approve,
  ...(f.cancelled ? { deleted: 'all' } : {}),
});
