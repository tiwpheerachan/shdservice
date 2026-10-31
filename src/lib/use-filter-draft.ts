'use client';

import * as React from 'react';
import { isFilterActive } from '@/lib/utils';

/**
 * A filter bar whose edits (`draft`) only take effect on ค้นหา (`apply` → `filters`); ล้างค่า (`reset`)
 * puts both back to `empty`, and `narrowed` says whether the applied filters differ from it.
 * `start` (default `empty`) is where draft + filters begin (e.g. read from the URL).
 *
 *   const f = useFilterDraft(NO_FILTER);
 *   <FilterBar onSearch={f.apply} onReset={f.reset}> … value={f.draft.no} onChange={(e) => f.setD('no', …)}
 */
export function useFilterDraft<F extends object>(empty: F, start?: F) {
  const [draft, setDraft] = React.useState<F>(start ?? empty);
  const [filters, setFilters] = React.useState<F>(start ?? empty);
  const setD = <K extends keyof F>(k: K, v: F[K]) => setDraft((f) => ({ ...f, [k]: v }));
  return {
    draft,
    setDraft,
    setD,
    filters,
    setFilters,
    apply: () => setFilters(draft),
    reset: () => {
      setDraft(empty);
      setFilters(empty);
    },
    narrowed: isFilterActive(filters, empty),
  };
}
