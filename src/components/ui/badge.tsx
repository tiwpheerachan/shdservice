import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { JOB_GROUP } from '@/lib/status-ids';

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

/** App badge — `tone` variants in the app palette (shadcn-style cva). */
export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium leading-4 whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-muted-foreground border-border',
        primary: 'bg-primary-soft text-primary border-primary/25',
        success: 'bg-success-soft text-success border-success/25',
        warning: 'bg-warning-soft text-warning border-warning/25',
        danger: 'bg-danger-soft text-danger border-danger/25',
        info: 'bg-info-soft text-info border-info/25',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  tone,
  dot,
  wrap,
  className,
  children,
}: VariantProps<typeof badgeVariants> & {
  dot?: boolean;
  /** for table columns: long text takes 2 lines instead of forcing the column wide */
  wrap?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  // no value (e.g. a job without a job type) → a quiet dash, not an empty pill that looks like a loading bar
  if (isEmpty(children)) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      data-slot="badge"
      className={cn(
        badgeVariants({ tone }),
        wrap && 'items-start whitespace-normal rounded-lg [&>[data-dot]]:mt-[5px]',
        className,
      )}
    >
      {dot && <span data-dot className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const isEmpty = (c: React.ReactNode): boolean =>
  c === null ||
  c === undefined ||
  c === false ||
  (typeof c === 'string' && c.trim() === '') ||
  (Array.isArray(c) && c.every(isEmpty));

/** a job status's colour, from its job_status_group — the dashboard KPI cards' colours (server
 *  computeDashboard). "ยกเลิกซ่อม (ลูกค้าไม่ตกลงซ่อม)" (6) counts as Cancel, like the server's kpiGroup. */
export function jobTone(status: string, group?: string): Tone {
  if (status.startsWith('ยกเลิกซ่อม')) return 'danger';
  if (status === 'งานใหม่') return 'primary'; // new job stands out from the rest of Pending
  switch (group?.trim()) {
    case JOB_GROUP.PENDING:
      return 'warning';
    case JOB_GROUP.REPAIRED:
      return 'info';
    case JOB_GROUP.FINISHED:
      return 'success';
    case JOB_GROUP.CANCEL:
      return 'danger';
    default:
      return 'neutral';
  }
}

/** `group` = the row's statusGroup; `wrap` (table columns): a long status ("อยู่ระหว่างการซ่อม - เริ่มเบิกอะไหล่") takes 2 lines */
export function StatusBadge({ status, group, wrap }: { status: string; group?: string; wrap?: boolean }) {
  return (
    <Badge tone={jobTone(status, group)} dot wrap={wrap}>
      {status}
    </Badge>
  );
}
