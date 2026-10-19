'use client';

import { useSearchParams } from 'next/navigation';
import { useRecord } from '@/lib/use-record';
import { useToast } from '@/components/ui/toast';
import type { JobDetail } from '@/server/services/jobs';

export type { JobDetail };

/**
 * Loads one job (GET /api/jobs/:no) for the job screens. Reads `?job=` (or `?no=` / `?jobNo=`) from the URL
 * so links open a screen with that job already loaded, and writes `?job=` back for every job shown (F5 keeps
 * it); `find(no)` is what the "ระบุหมายเลขงาน" bar calls. `loading` / `error` feed <RecordGate>; `onLoaded` / `onMissing` are the toasts
 * for a lookup the user asked for (default: เรียกข้อมูลงานสำเร็จ / ไม่พบหมายเลขงาน; the URL's job opens quietly); `onRecord` fills the page's form
 * from every job that arrives, including the one `setJob` hands back after a save.
 */
export function useJob(
  opts: {
    onLoaded?: (job: JobDetail) => void;
    onMissing?: (no: string, message: string) => void;
    /** every job that arrives (loaded or saved) — the page fills its form from it */
    onRecord?: (job: JobDetail) => void;
  } = {},
) {
  const sp = useSearchParams();
  const { push } = useToast();
  // ?job= is what every link writes (list, bell, quotation, เปิดงานใหม่); ?no= / ?jobNo= open the same
  const initial = sp.get('job') || sp.get('no') || sp.get('jobNo') || '';
  const r = useRecord<JobDetail>({
    url: (no) => `/api/jobs/${encodeURIComponent(no)}`,
    pick: (d: { job: JobDetail }) => d.job,
    initial,
    onLoaded: opts.onLoaded ?? ((j) => push({ kind: 'success', title: 'เรียกข้อมูลงานสำเร็จ', desc: j.no })),
    onMissing: opts.onMissing ?? ((no) => push({ kind: 'error', title: 'ไม่พบหมายเลขงาน', desc: no })),
    onRecord: (j) => {
      // a refresh (F5) reopens the job on screen, not the one the page was opened with
      if (new URLSearchParams(window.location.search).get('job') !== j.no)
        window.history.replaceState(null, '', `?job=${encodeURIComponent(j.no)}`);
      opts.onRecord?.(j);
    },
  });
  return {
    jobNo: r.data?.no ?? r.no,
    job: r.data,
    loading: r.loading,
    error: r.error,
    find: r.find,
    setJob: r.setData,
    reload: r.reload,
  };
}
