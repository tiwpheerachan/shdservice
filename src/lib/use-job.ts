"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { api, errMsg } from "@/lib/api";
import type { JobDetail } from "@/server/services/jobs";

export type { JobDetail };

/**
 * Loads one job (GET /api/jobs/:no) for the job screens. Reads `?job=` from the
 * URL so links from the job list open a screen with that job already loaded;
 * `find(no)` is what the "ระบุหมายเลขงาน" bar calls.
 */
export function useJob() {
  const sp = useSearchParams();
  const initial = sp.get("job") ?? "";
  const [jobNo, setJobNo] = React.useState(initial);
  const [job, setJob] = React.useState<JobDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async (no: string) => {
    const v = no.trim().toUpperCase();
    if (!v) return null;
    setLoading(true);
    setError(null);
    try {
      const d = await api<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(v)}`);
      setJob(d.job);
      setJobNo(d.job.no);
      return d.job;
    } catch (e) {
      setJob(null);
      setError(errMsg(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (initial) void load(initial);
  }, [initial, load]);

  return { jobNo, job, loading, error, find: load, setJob, reload: () => (jobNo ? load(jobNo) : Promise.resolve(null)) };
}
