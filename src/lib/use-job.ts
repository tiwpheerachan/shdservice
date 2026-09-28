"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useRecord } from "@/lib/use-record";
import type { JobDetail } from "@/server/services/jobs";

export type { JobDetail };

const fetchJob = (no: string) => api<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(no)}`).then((d) => d.job);

/**
 * Loads one job (GET /api/jobs/:no) for the job screens. Reads `?job=` from the
 * URL so links from the job list open a screen with that job already loaded;
 * `find(no)` is what the "ระบุหมายเลขงาน" bar calls. `loading` / `error` feed <RecordGate>.
 */
export function useJob() {
  const sp = useSearchParams();
  const initial = sp.get("job") ?? "";
  const [jobNo, setJobNo] = React.useState(initial);
  const { data: job, setData: setJob, loading, error, load } = useRecord(fetchJob, !!initial);

  const find = React.useCallback(
    async (no: string) => {
      const j = await load(no);
      if (j) setJobNo(j.no);
      return j;
    },
    [load]
  );

  React.useEffect(() => {
    if (initial) void find(initial);
  }, [initial, find]);

  return { jobNo, job, loading, error, find, setJob, reload: () => (jobNo ? find(jobNo) : Promise.resolve(null)) };
}
