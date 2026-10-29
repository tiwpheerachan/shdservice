'use client';

import * as React from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import type { JobFormState } from '@/components/shared/job-form';
import type { JobChecks, SeenJob } from '@/server/services/job-checks';
import { useApi } from '@/data/db';
import { qs } from '@/data/keys';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';
import { NO_SERIAL, WAIT_SERIAL } from '@/lib/validation/job';

/**
 * What GET /api/jobs/checks warns about for this form (Serial on other jobs, SO on another customer's job,
 * a serial / shop that looks like another brand) — asked once the typing settles, and only about what was
 * changed from `was` (the job as loaded: an edit does not warn about values nobody touched). One request
 * serves every field. Warnings only: nothing here stops a save. `on` = false asks nothing.
 */
export function useJobChecks(s: JobFormState, was: JobFormState, on = true): JobChecks | null {
  const changed = (k: 'serial' | 'so' | 'brand' | 'shopName') => s[k] !== was[k];
  const serial = s.serial.trim();
  const params = {
    serial: (changed('serial') || changed('brand')) && serial !== NO_SERIAL && serial !== WAIT_SERIAL ? serial : '',
    so: changed('so') || s.customer?.code !== was.customer?.code ? s.so.trim() : '',
    brand: s.brand,
    shop: changed('shopName') || changed('brand') ? s.shopName.trim() : '',
    customer: s.customer?.code ?? '',
    job: s.jobNo,
  };
  const want =
    on && (params.serial.length >= 4 || params.so.length >= 4 || (!!params.brand && params.shop.length >= 2));
  // the URL is what settles (a string: an object would be new on every render and never settle). While typing,
  // the last answer stays on screen until the next one arrives — hidden on every key, the rows below jumped
  // (QA 2026-10-27); nothing left to ask (a field emptied) clears it at once
  const live = want ? `/api/jobs/checks${qs(params)}` : null;
  const url = useDebouncedValue(live, 500);
  const data = useApi<JobChecks>(url, { quiet: true }).data ?? null;
  const [shown, setShown] = React.useState<JobChecks | null>(null);
  if (live && live === url && data && data !== shown) setShown(data);
  return live ? shown : null;
}

/** a warning line under a field, with an optional one-tap action */
export function Warn({
  tone = 'warning',
  children,
  action,
}: {
  tone?: 'warning' | 'danger' | 'info';
  children: React.ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  const Icon = tone === 'info' ? Info : AlertTriangle;
  return (
    <p
      role="status"
      className={cn(
        'mt-1.5 flex flex-wrap items-start gap-x-2 gap-y-1 text-xs',
        tone === 'danger' ? 'text-danger' : tone === 'info' ? 'text-info' : 'text-warning',
      )}
    >
      <Icon className="mt-px h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {action.label}
        </button>
      )}
    </p>
  );
}

const thaiDate = (ymd: string) =>
  new Date(`${ymd}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });

/** the jobs a value was seen on, as links (a new tab: the form here stays as it is) */
export function JobLinks({ jobs }: { jobs: SeenJob[] }) {
  return (
    <>
      {jobs.slice(0, 3).map((j, i) => (
        <React.Fragment key={j.no}>
          {i > 0 && ', '}
          <a
            href={`/jobs/edit?id=${j.id}`}
            target="_blank"
            rel="noopener"
            className="num font-semibold underline underline-offset-2"
          >
            {j.no}
          </a>{' '}
          ({thaiDate(j.date)})
        </React.Fragment>
      ))}
      {jobs.length > 3 && ` และอีก ${jobs.length - 3} งาน`}
    </>
  );
}

/**
 * Shopee's order no. starts with its order date (YYMMDD): far from the Sale Order Date (prod: 92% within
 * 3 days before / 1 after) → probably one of the two is wrong
 */
export function shopeeDateOff(so: string, saleDate: string): string | null {
  const m = /^(\d{2})(\d{2})(\d{2})/.exec(so.trim());
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) return null;
  const inSo = `20${m[1]}-${m[2]}-${m[3]}`;
  const days = (Date.parse(inSo) - Date.parse(saleDate)) / 86_400_000;
  return Number.isNaN(days) || (days >= -3 && days <= 1) ? null : inSo;
}
export { thaiDate };
