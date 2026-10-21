'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { api, errMsg } from '@/lib/api';
import { recordNo } from '@/data/keys';

/**
 * One record looked up by its number for the "ระบุหมายเลข… → แก้ไข" screens (jobs, quotations,
 * sale orders) — the loading / error state <RecordGate> shows.
 *
 * The number being looked at is state; swr reads it (so an older answer can never replace a newer
 * lookup, and nothing is fetched from an effect):
 *  - `initial`: the number from the URL — loaded on mount, without a toast
 *  - `find(no)`: the search bar — loads that number (again, if it is the current one)
 *  - `onLoaded` / `onMissing`: the page's toasts for a lookup the user asked for
 *  - `onRecord`: every record that arrives — loaded (URL or search) or saved through `setData` —
 *    e.g. to fill the page's form from it (an event, not an effect watching the data)
 *  - `setData`: the saved record the API answered with, shown without another read
 *  - `loading`: also while the record on screen is read again (โหลดใหม่ after a 409, `reload`) — <RecordGate>
 *    locks the form until it lands, so nothing typed meanwhile is overwritten by it or saved over it
 *
 * The URL's record may come with the page (<Prefetched>, src/server/prefetch.ts — the record itself, as
 * `pick` returns it): then it is not read again on mount, and `onRecord` gets it as if it had just loaded.
 * Not on a back/forward replay: <Prefetched> offers a payload's records once, so the replayed (older)
 * record is never taken for the current one — it is read again.
 *
 * `initial` is read once: a screen whose URL number can change under it (a link to another record on the
 * same route — Next keeps the page mounted) is keyed by that number: <RecordKey>, or `key` on the server.
 */
export function useRecord<T>(opts: {
  url: (no: string) => string;
  /** the record inside the API answer, e.g. (d) => d.job */
  pick: (answer: never) => T;
  initial?: string;
  onLoaded?: (record: T) => void;
  onMissing?: (no: string, message: string) => void;
  onRecord?: (record: T) => void;
}) {
  const [no, setNo] = React.useState(() => recordNo(opts.initial ?? ''));
  const quiet = React.useRef(!!no); // the URL's record opens without a "found" toast
  const key = no ? opts.url(no) : null;
  const { fallback } = useSWRConfig();
  const [prefetched] = React.useState(() => (key ? (fallback?.[key] as T | undefined) : undefined));

  const { pick, onLoaded, onMissing, onRecord } = opts;
  const { data, error, isValidating, mutate } = useSWR<T>(key, async (url: string) => pick((await api(url)) as never), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
    keepPreviousData: false, // never show one record under another's number
    revalidateOnMount: prefetched === undefined, // only the first mount: a new number is always read
    revalidateIfStale: true,
    dedupingInterval: 0,
    // swr calls these from the latest render's options → `key` / `no` are the current lookup
    onSuccess: (d, k) => {
      if (k !== key) return;
      onRecord?.(d);
      if (quiet.current) quiet.current = false;
      else onLoaded?.(d);
    },
    onError: (e, k) => {
      if (k !== key) return;
      quiet.current = false;
      onMissing?.(no, errMsg(e));
    },
  });

  // the record that came with the page: what onSuccess does for a record read on mount
  React.useEffect(() => {
    if (prefetched === undefined) return;
    quiet.current = false;
    onRecord?.(prefetched);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the record the page came with
  }, []);

  const find = React.useCallback(
    (v: string) => {
      const n = recordNo(v);
      if (!n) return;
      quiet.current = false;
      if (n === no)
        void mutate(); // the same number again → read it again
      else setNo(n);
    },
    [no, mutate],
  );
  const setData = (d: T) => {
    void mutate(d, { revalidate: false });
    onRecord?.(d);
  };
  const reload = React.useCallback(() => mutate(), [mutate]);

  return { no, data: data ?? null, loading: isValidating, error: error ? errMsg(error) : null, find, setData, reload };
}

/** its children remounted for each record number `of(searchParams)` names (see useRecord) — inside a <Suspense> */
export function RecordKey({
  of,
  children,
}: {
  of: (sp: Pick<URLSearchParams, 'get'>) => string;
  children: React.ReactNode;
}) {
  const sp = useSearchParams();
  return React.createElement(React.Fragment, { key: recordNo(of(sp)) }, children); // .ts: no JSX
}
