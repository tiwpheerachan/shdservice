"use client";

import { useSearchParams } from "next/navigation";
import { useRecord } from "@/lib/use-record";
import type { JobDetail } from "@/server/services/jobs";

export type { JobDetail };

/**
 * Loads one job (GET /api/jobs/:no) for the job screens. Reads `?job=` from the URL so links from
 * the job list open a screen with that job already loaded; `find(no)` is what the "ระบุหมายเลขงาน"
 * bar calls. `loading` / `error` feed <RecordGate>; `onLoaded` / `onMissing` are the page's toasts
 * for a lookup the user asked for (the URL's job opens quietly); `onRecord` fills the page's form
 * from every job that arrives, including the one `setJob` hands back after a save.
 */
export function useJob(
  opts: {
    onLoaded?: (job: JobDetail) => void;
    onMissing?: (no: string, message: string) => void;
    /** every job that arrives (loaded or saved) — the page fills its form from it */
    onRecord?: (job: JobDetail) => void;
  } = {}
) {
  const initial = useSearchParams().get("job") ?? "";
  const r = useRecord<JobDetail>({
    url: (no) => `/api/jobs/${encodeURIComponent(no)}`,
    pick: (d: { job: JobDetail }) => d.job,
    initial,
    ...opts,
  });
  return { jobNo: r.data?.no ?? r.no, job: r.data, loading: r.loading, error: r.error, find: r.find, setJob: r.setData, reload: r.reload };
}
