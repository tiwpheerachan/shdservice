'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import type { ServerTableState } from '@/components/ui/data-table';
import { TAT_BUCKET_LABEL } from '@/data/options';
import { useServerTable } from '@/lib/use-server-table';
import { NO_FILTER, fromQuery, type Filters, type TatSource } from './filters';

export { toParams, type Filters, type TatSource } from './filters';

/** dashboard TAT buckets (keys match the dashboard's TatKey) */
export const TAT_BUCKET: Record<string, string> = { ...TAT_BUCKET_LABEL, total: 'ทุกช่วงวัน' };

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
