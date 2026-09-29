"use client";

import * as React from "react";
import useSWR from "swr";
import { api, errMsg } from "@/lib/api";

/**
 * One record looked up by its number for the "ระบุหมายเลข… → แก้ไข" screens (jobs, quotations,
 * sale orders) — the loading / error state <RecordGate> shows.
 *
 * The number being looked at is state; swr reads it (so an older answer can never replace a newer
 * lookup, and nothing is fetched from an effect):
 *  - `initial`: the number from the URL — loaded on mount, without a toast
 *  - `find(no)`: the search bar — loads that number (again, if it is the current one)
 *  - `onLoaded` / `onMissing`: the page's toasts for a lookup the user asked for
 *  - `setData`: the saved record the API answered with, shown without another read
 */
export function useRecord<T>(opts: {
  url: (no: string) => string;
  /** the record inside the API answer, e.g. (d) => d.job */
  pick: (answer: never) => T;
  initial?: string;
  onLoaded?: (record: T) => void;
  onMissing?: (no: string, message: string) => void;
}) {
  const norm = (v: string) => v.trim().toUpperCase();
  const [no, setNo] = React.useState(() => norm(opts.initial ?? ""));
  const quiet = React.useRef(!!no); // the URL's record opens without a "found" toast
  const key = no ? opts.url(no) : null;

  const { pick, onLoaded, onMissing } = opts;
  const { data, error, isLoading, mutate } = useSWR<T>(key, async (url: string) => pick((await api(url)) as never), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
    keepPreviousData: false, // never show one record under another's number
    revalidateOnMount: true,
    revalidateIfStale: true,
    dedupingInterval: 0,
    // swr calls these from the latest render's options → `key` / `no` are the current lookup
    onSuccess: (d, k) => {
      if (k !== key) return;
      if (quiet.current) quiet.current = false;
      else onLoaded?.(d);
    },
    onError: (e, k) => {
      if (k !== key) return;
      quiet.current = false;
      onMissing?.(no, errMsg(e));
    },
  });

  const find = React.useCallback(
    (v: string) => {
      const n = norm(v);
      if (!n) return;
      quiet.current = false;
      if (n === no) void mutate(); // the same number again → read it again
      else setNo(n);
    },
    [no, mutate]
  );
  const setData = React.useCallback((d: T) => void mutate(d, { revalidate: false }), [mutate]);
  const reload = React.useCallback(() => mutate(), [mutate]);

  return { no, data: data ?? null, loading: isLoading, error: error ? errMsg(error) : null, find, setData, reload };
}
