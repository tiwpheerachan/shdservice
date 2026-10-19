'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { PAGE_SIZES, type ServerTableState } from '@/components/ui/data-table';
import { TAT_BUCKET_LABEL } from '@/data/options';
import { useServerTable } from '@/lib/use-server-table';

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
};
const NO_FILTER: Filters = {
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
});

/** dashboard TAT buckets (keys match the dashboard's TatKey) */
export const TAT_BUCKET: Record<string, string> = { ...TAT_BUCKET_LABEL, total: 'ทุกช่วงวัน' };
export type TatSource = { bucket: string; status: string; type: string };

/**
 * The list in the URL (filters, table, dashboard chip) — written as it changes, read on load, so a refresh keeps
 * it. Same names as the deep links into it: dashboard TAT  ?src=tat&bucket=d814&open=1&statusId=3&status=…&from=…
 * &to=…&type=…, dashboard KPI  ?src=kpi&group=Pending&label=…, bell  ?src=overdue[&engineer=<id>], customer page
 * ?customer=C43600.
 */
function toQuery(f: Filters, t: ServerTableState, tat: TatSource | null, kpi: string | null) {
  const p = new URLSearchParams();
  if (tat) p.set('src', 'tat');
  if (tat?.bucket) p.set('bucket', tat.bucket);
  if (kpi) p.set('src', 'kpi');
  if (kpi) p.set('label', kpi);
  for (const k of Object.keys(NO_FILTER) as (keyof Filters)[])
    if (f[k] !== NO_FILTER[k]) p.set(k === 'statusGroup' ? 'group' : k, f[k] === true ? '1' : String(f[k]));
  if (t.page > 1) p.set('page', String(t.page));
  if (t.pageSize !== 25) p.set('size', String(t.pageSize));
  if (t.sort) p.set('sort', `${t.sort.key}.${t.sort.dir}`);
  return p.toString();
}
function fromQuery(p: URLSearchParams) {
  const g = (k: string) => p.get(k)?.trim() ?? '';
  const f: Filters = { ...NO_FILTER };
  for (const k of Object.keys(NO_FILTER) as (keyof Filters)[]) {
    const v = g(k === 'statusGroup' ? 'group' : k);
    if (v) Object.assign(f, { [k]: typeof NO_FILTER[k] === 'boolean' ? v === '1' : v });
  }
  if (g('src') === 'overdue') f.overdue = true;
  // ids and choices: anything else is no filter
  for (const k of ['statusId', 'engineer', 'createdBy'] as const) if (!/^\d+$/.test(f[k])) f[k] = '';
  if (!['create', 'reception', 'closed'].includes(f.dateBy)) f.dateBy = 'create';
  if (!['', 'yes', 'no'].includes(f.cost)) f.cost = '';
  // sort=<key>.<dir> (an unknown key is ignored by the server's column map)
  const [, sortKey, sortDir] = /^(.+)\.(asc|desc)$/.exec(g('sort')) ?? [];
  return {
    filters: f,
    tat: g('src') === 'tat' ? { bucket: g('bucket'), status: f.status, type: f.type } : null,
    kpi: g('src') === 'kpi' ? g('label') || f.statusGroup : null,
    page: Math.max(1, parseInt(g('page'), 10) || 1),
    pageSize: PAGE_SIZES.includes(Number(g('size'))) ? Number(g('size')) : 25,
    sort: sortKey ? { key: sortKey, dir: sortDir === 'desc' ? ('desc' as const) : ('asc' as const) } : null,
  };
}

/**
 * The job list's filters + table state kept in the URL (toQuery / fromQuery), and the dashboard TAT / KPI source
 * a deep link came from. `onSearch` is the filter bar's ค้นหา, `clearAll` its ล้างค่า (and the chips' ✕).
 */
export function useJobListUrl() {
  // the URL holds the list (toQuery): read on load and on EVERY change of it, not only on mount — a link to
  // this page from this page (the bell in the topbar, back / forward) changes the query string without
  // remounting. A link starts from a clean filter set, so e.g. one engineer from the bell never lingers.
  const search = useSearchParams().toString();
  const [init] = React.useState(() => fromQuery(new URLSearchParams(search)));
  // FilterBar (applied on ค้นหา) + table state → one server query per change
  const { draft, setDraft, setD, filters, setFilters, reset, narrowed, table, pageArgs, server } = useServerTable(
    NO_FILTER,
    { start: init.filters, page: init.page, pageSize: init.pageSize, sort: init.sort },
  );
  // where a dashboard TAT deep link came from (shown as a clearable chip)
  const [tat, setTat] = React.useState<TatSource | null>(init.tat);
  // the dashboard KPI card a deep link came from (its label), shown the same way
  const [kpi, setKpi] = React.useState<string | null>(init.kpi);
  /** the query string we wrote ourselves (below) — not a new link to read */
  const ownUrl = React.useRef(search);
  React.useEffect(() => {
    if (search === ownUrl.current) return;
    const next = fromQuery(new URLSearchParams(search));
    setDraft(next.filters);
    setFilters(next.filters);
    setTat(next.tat);
    setKpi(next.kpi);
  }, [search, setDraft, setFilters]); // the setters are stable (useState)
  React.useEffect(() => {
    const q = toQuery(filters, table, tat, kpi);
    if (q === new URLSearchParams(window.location.search).toString()) return;
    ownUrl.current = q;
    window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}`);
  }, [filters, table, tat, kpi]);
  const clearAll = () => {
    reset();
    setTat(null);
    setKpi(null);
  };
  const onSearch = () => {
    // editing any of the TAT/KPI-defining fields leaves that view: drop its hidden "open jobs only" /
    // status group too
    const TAT_KEYS = ['status', 'statusId', 'dateBy', 'from', 'to', 'type'] as const;
    const next =
      (tat || kpi) && TAT_KEYS.some((k) => draft[k] !== filters[k])
        ? { ...draft, open: false, statusGroup: '' }
        : draft;
    if (next !== draft) {
      setTat(null);
      setKpi(null);
      setDraft(next);
    }
    setFilters(next);
  };
  return { init, draft, setDraft, setD, filters, narrowed, table, pageArgs, server, tat, kpi, clearAll, onSearch };
}
