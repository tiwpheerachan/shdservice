"use client";

import * as React from "react";
import { errMsg } from "@/lib/api";

/**
 * Loads one record by its number for the "ระบุหมายเลข… → แก้ไข" screens (jobs, quotations, sale
 * orders) and keeps the loading / error state that <RecordGate> shows.
 *
 *  - `fetchOne` must be stable (a module-level function)
 *  - `startsLoading`: the page will load a number from the URL right away — start in the loading
 *    state so the "ระบุหมายเลข" card does not flash before the skeleton
 *  - only the latest lookup wins: an older answer that arrives late is dropped
 *
 * `load(no)` resolves to the record, `null` when it failed (error set), or `undefined` when a newer
 * lookup replaced it (show nothing).
 */
export function useRecord<T>(fetchOne: (no: string) => Promise<T>, startsLoading = false) {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(startsLoading);
  const [error, setError] = React.useState<string | null>(null);
  const seq = React.useRef(0);

  const load = React.useCallback(
    async (no: string): Promise<T | null | undefined> => {
      const v = no.trim().toUpperCase();
      if (!v) return null;
      const id = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const d = await fetchOne(v);
        if (id !== seq.current) return undefined;
        setData(d);
        return d;
      } catch (e) {
        if (id !== seq.current) return undefined;
        setData(null);
        setError(errMsg(e));
        return null;
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    [fetchOne]
  );

  return { data, setData, loading, error, load };
}
