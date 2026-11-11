'use client';

import * as React from 'react';
import type { ServerTableState } from '@/components/ui/data-table';
import { useFilterDraft } from '@/lib/use-filter-draft';
import { FIRST_PAGE, pageArgsOf } from '@/data/keys';

/**
 * The state every server-paged list page keeps: a filter bar whose edits (`draft`) only take effect on
 * ค้นหา (`apply` → `filters`) — see useFilterDraft — and the table's page / size / search / sort as DataTable reports it.
 *
 *   const t = useServerTable(NO_FILTER);
 *   const { rows, total, … } = useXxxPage({ ...t.pageArgs, ...t.filters });
 *   <FilterBar onSearch={t.apply} onReset={t.reset}> … value={t.draft.no} onChange={(e) => t.setD('no', …)}
 *   <DataTable narrowed={t.narrowed} onClearFilters={t.reset} server={{ ...t.server, total }} />
 *
 * `empty` is what ล้างค่า goes back to and what "narrowed" compares against; `start` (default `empty`) is
 * where draft + filters begin (e.g. read from the URL). page / pageSize / sort: where the table begins —
 * pass the same pageSize to DataTable. A new `filters` value sends the table back to page 1 (resetKey).
 */
export function useServerTable<F extends object>(
  empty: F,
  opts: { start?: F; page?: number; pageSize?: number; sort?: ServerTableState['sort'] } = {},
) {
  const f = useFilterDraft(empty, opts.start);
  const [table, setTable] = React.useState<ServerTableState>({
    page: opts.page ?? FIRST_PAGE.page,
    pageSize: opts.pageSize ?? FIRST_PAGE.pageSize,
    q: FIRST_PAGE.q,
    sort: opts.sort ?? FIRST_PAGE.sort,
  });
  return {
    ...f,
    table,
    /** page / pageSize / q / sort / dir — spread into the page hook (and q into the export) */
    pageArgs: pageArgsOf(table),
    /** DataTable's `server` prop minus `total` */
    server: {
      onChange: setTable,
      resetKey: JSON.stringify(f.filters),
      initial: { page: opts.page, sort: opts.sort },
    },
  };
}
