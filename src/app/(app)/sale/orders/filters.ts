/** the sale order list's filter bar — pure, shared by the page and its server render (page.tsx) */

export type Filters = {
  no: string;
  customer: string;
  from: string;
  to: string;
  code: string;
  sales: string;
  approve: string;
};
export const NO_FILTER: Filters = { no: '', customer: '', from: '', to: '', code: '', sales: '', approve: '' };
export const WAITING = 'รออนุมัติ'; // approve_status 2 (its approve_name_th — the list filters by that name)
/** the list's query (after page / pageSize / q / sort) */
export const listParams = (f: Filters) => ({
  no: f.no,
  customer: f.customer,
  code: f.code,
  from: f.from,
  to: f.to,
  sales: f.sales,
  approve: f.approve,
});
