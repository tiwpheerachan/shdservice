import { cn } from "@/lib/utils";

export type Tone =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  primary: "bg-primary-soft text-primary border-primary/25",
  success: "bg-success-soft text-success border-success/25",
  warning: "bg-warning-soft text-warning border-warning/25",
  danger: "bg-danger-soft text-danger border-danger/25",
  info: "bg-info-soft text-info border-info/25",
};

export function Badge({
  tone = "neutral",
  dot,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium leading-4 whitespace-nowrap",
        tones[tone],
        className
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const JOB_TONE: Record<string, Tone> = {
  "งานใหม่": "info",
  "อยู่ระหว่างดำเนินการ": "warning",
  "รอลูกค้าตอบกลับ": "warning",
  "รออะไหล่": "warning",
  "รออนุมัติ": "warning",
  "ส่งซ่อม Out-Source": "info",
  "ซ่อมเสร็จ": "success",
  "ปิดงาน": "success",
  "ส่งคืนลูกค้าแล้ว": "success",
  "อนุมัติ": "success",
  "ยกเลิก": "danger",
  "ไม่อนุมัติ": "danger",
  Active: "success",
  Inactive: "neutral",
  Cancel: "danger",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={JOB_TONE[status] ?? "neutral"} dot>
      {status}
    </Badge>
  );
}
