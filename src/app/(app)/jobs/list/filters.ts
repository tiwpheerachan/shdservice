/**
 * The job list's filters and how they read from / go to a URL — pure (no React), so the server page
 * (page.tsx, which renders the first page into the HTML) and the browser (use-job-list-url) agree.
 */
import { PAGE_SIZES } from '@/data/keys';

/** Filter bar — every field is AND-ed on the server (see JobFilters in services/jobs.ts). */
export type Filters = {
  no: string;
  ref: string;
  brand: string;
  model: string;
  type: string;
  typeDetail: string;
  createdBy: string;
  engineer: string;
  dateBy: 'create' | 'reception' | 'closed';
  from: string;
  to: string;
  customer: string;
  phone: string;
  tracking: string;
  imei: string;
  warranty: string;
  bounce: boolean;
  within30: boolean;
  cost: '' | 'yes' | 'no';
  status: string;
  /* status is chosen BY ID (list from job_status in the DB — the TAT link sends the id too); `status` keeps
     the name for display only. `open` (not Finished/Cancel) is set only by a dashboard TAT link. */
  statusId: string;
  open: boolean;
  /** Pending | Repaired | Finished | Cancel — set only by a dashboard KPI card (counts by status group) */
  statusGroup: string;
  /** open + past the customer due date — set only by the notification bell's link */
  overdue: boolean;
  /** dashboard TAT bucket (d13 … over30) — set only by a TAT number's link */
  tat: string;
};
export const NO_FILTER: Filters = {
  no: '',
  ref: '',
  brand: '',
  model: '',
  type: '',
  typeDetail: '',
  createdBy: '',
  engineer: '',
  dateBy: 'create',
  from: '',
  to: '',
  customer: '',
  phone: '',
  tracking: '',
  imei: '',
  warranty: '',
  bounce: false,
  within30: false,
  cost: '',
  status: '',
  statusId: '',
  open: false,
  statusGroup: '',
  overdue: false,
  tat: '',
};
/** query-string form of the applied filters — shared by the table hook and the Excel export */
export const toParams = (f: Filters) => ({
  no: f.no,
  ref: f.ref,
  brand: f.brand,
  model: f.model,
  type: f.type,
  typeDetail: f.typeDetail,
  createdBy: f.createdBy,
  engineer: f.engineer,
  dateBy: f.dateBy === 'create' ? '' : f.dateBy,
  from: f.from,
  to: f.to,
  customer: f.customer,
  phone: f.phone,
  tracking: f.tracking,
  imei: f.imei,
  warranty: f.warranty,
  bounce: f.bounce ? 1 : '',
  within30: f.within30 ? 1 : '',
  cost: f.cost,
  // statusId wins over the name (exact id match — no trailing-space / spelling issues with names)
  status: f.statusId ? '' : f.status,
  statusId: f.statusId,
  open: f.open ? 1 : '',
  statusGroup: f.statusGroup,
  overdue: f.overdue ? 1 : '',
  tat: f.tat,
});

export type TatSource = { bucket: string; status: string; type: string };

/** a list URL's query → filters, table state and the dashboard card a deep link came from */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fromQuery(p: Pick<URLSearchParams, 'get'>) {
  const g = (k: string) => p.get(k)?.trim() ?? '';
  const f: Filters = { ...NO_FILTER };
  for (const k of Object.keys(NO_FILTER) as (keyof Filters)[]) {
    const v = g(k === 'statusGroup' ? 'group' : k);
    if (v) Object.assign(f, { [k]: typeof NO_FILTER[k] === 'boolean' ? v === '1' : v });
  }
  if (g('src') === 'overdue') f.overdue = true;
  // ids and choices: anything else is no filter (a status is its code; a person their uuid — ADR 0008)
  if (!/^\d+$/.test(f.statusId)) f.statusId = '';
  for (const k of ['engineer', 'createdBy'] as const) if (!UUID.test(f[k])) f[k] = '';
  if (!['create', 'reception', 'closed'].includes(f.dateBy)) f.dateBy = 'create';
  if (!['', 'yes', 'no'].includes(f.cost)) f.cost = '';
  if (!['', 'd13', 'd47', 'd814', 'd1530', 'over30'].includes(f.tat)) f.tat = '';
  // sort=<key>.<dir> (an unknown key is ignored by the server's column map)
  const [, sortKey, sortDir] = /^(.+)\.(asc|desc)$/.exec(g('sort')) ?? [];
  return {
    filters: f,
    tat: g('src') === 'tat' ? { bucket: f.tat || 'total', status: f.status, type: f.type } : null,
    kpi: g('src') === 'kpi' ? g('label') || f.statusGroup : null,
    page: Math.max(1, parseInt(g('page'), 10) || 1),
    pageSize: PAGE_SIZES.includes(Number(g('size'))) ? Number(g('size')) : 25,
    sort: sortKey ? { key: sortKey, dir: sortDir === 'desc' ? ('desc' as const) : ('asc' as const) } : null,
  };
}
