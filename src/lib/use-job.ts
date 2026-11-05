'use client';

import { useSearchParams } from 'next/navigation';
import { useRecord } from '@/lib/use-record';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import type { JobDetail } from '@/server/services/jobs';
import type { Job } from '@/data/types';
import { jobIdParam, jobKey, qs, recordNo } from '@/data/keys';

export type { JobDetail };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A job number (typed or scanned: J2612164) → the job's id, the uuid every job link and API path uses (ADR 0008);
 * null = no such job. Through the job search (GET /data/jobs — any job screen's view), cancelled jobs included.
 */
export async function jobIdOf(no: string): Promise<string | null> {
  const n = recordNo(no);
  if (!n) return null;
  const d = await api<{ rows: Job[] }>(`/api/data/jobs${qs({ paged: 1, pageSize: 5, no: n, includeCancelled: 1 })}`);
  return d.rows.find((r) => r.no === n)?.id ?? null;
}

/**
 * Loads one job (GET /api/jobs/:id) for the job screens. Reads `?id=` (the job's uuid) from the URL so links open
 * a screen with that job already loaded, and writes `?id=` back for every job shown (F5 keeps it); `find(v)` is
 * what the "ระบุหมายเลขงาน" bar calls — a job's id (a picked search row) or a number typed / scanned (looked up
 * first: jobIdOf). `loading` / `error` feed <RecordGate>; `onLoaded` / `onMissing` are the toasts for a lookup the
 * user asked for (default: เรียกข้อมูลงานสำเร็จ / ไม่พบหมายเลขงาน; the URL's job opens quietly); `onRecord` fills
 * the page's form from every job that arrives, including the one `setJob` hands back after a save.
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
  const onMissing = opts.onMissing ?? ((no: string) => push({ kind: 'error', title: 'ไม่พบหมายเลขงาน', desc: no }));
  const r = useRecord<JobDetail>({
    url: jobKey,
    pick: (d: { job: JobDetail }) => d.job,
    initial: jobIdParam(sp),
    onLoaded: opts.onLoaded ?? ((j) => push({ kind: 'success', title: 'เรียกข้อมูลงานสำเร็จ', desc: j.no })),
    // an id that is no job (an old / mistyped link): the toast shows no uuid
    onMissing: (id, message) => onMissing(UUID.test(id) ? '' : id, message),
    onRecord: (j) => {
      // a refresh (F5) reopens the job on screen, not the one the page was opened with
      if (new URLSearchParams(window.location.search).get('id') !== j.id)
        window.history.replaceState(null, '', `?id=${encodeURIComponent(j.id)}`);
      opts.onRecord?.(j);
    },
  });
  const find = async (v: string) => {
    const t = v.trim();
    if (!t) return;
    if (UUID.test(t)) return r.find(t);
    const id = await jobIdOf(t).catch(() => null);
    if (id) r.find(id);
    else onMissing(recordNo(t), 'ไม่พบหมายเลขงาน');
  };
  return {
    /** the number of the job on screen (what the search bar shows) */
    jobNo: r.data?.no ?? '',
    job: r.data,
    loading: r.loading,
    error: r.error,
    find,
    setJob: r.setData,
    reload: r.reload,
  };
}
