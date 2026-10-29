'use client';

import * as React from 'react';
import Link from 'next/link';
import { MoreHorizontal, Printer, Wrench, PackageCheck, FileText, Ban } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/shadcn/popover';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import type { Job } from '@/data/types';
import { postJson, errMsg } from '@/lib/api';
import { useAccess } from '@/lib/use-access';
import { notClosableMsg } from '@/lib/validation/job';
import { JS, JOB_GROUP } from '@/lib/status-ids';

const ITEM =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent';

/**
 * The row's "…" menu, as the legacy list's row buttons: print the receipt, บันทึกการทำงาน, ปิดงาน-ส่งคืนสินค้า,
 * print the return note (closed jobs), ยกเลิกงาน — each only when the user may and the job's status allows it.
 */
export function JobRowMenu({ job, onCancel }: { job: Job; onCancel?: (job: Job) => void }) {
  const { canLink } = useAccess();
  const [open, setOpen] = React.useState(false);
  const no = encodeURIComponent(job.no);
  const group = job.statusGroup ?? '';
  const live = job.statusId !== JS.CANCELLED && group !== JOB_GROUP.CANCEL;
  const items: { label: string; icon: React.ElementType; href: string }[] = [
    { label: 'พิมพ์ใบรับงาน', icon: Printer, href: `/print/job/${no}` },
    ...(live && group !== JOB_GROUP.FINISHED && canLink({ href: '/jobs/repair', need: 'edit' })
      ? [{ label: 'บันทึกการทำงาน', icon: Wrench, href: `/jobs/repair?job=${no}` }]
      : []),
    ...(live &&
    !notClosableMsg(job.statusId ?? null, group, job.status) &&
    canLink({ href: '/jobs/close', need: 'edit' })
      ? [{ label: 'บันทึกปิดงาน-ส่งคืนสินค้า', icon: PackageCheck, href: `/jobs/close?job=${no}` }]
      : []),
    ...(group === JOB_GROUP.FINISHED
      ? [{ label: 'พิมพ์ใบปิดงาน / ใบส่งคืน', icon: FileText, href: `/print/job/${no}/return` }]
      : []),
  ];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="เพิ่มเติม"
          aria-label={`เพิ่มเติม ${job.no}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1.5">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            prefetch={false}
            target={it.href.startsWith('/print/') ? '_blank' : undefined}
            onClick={() => setOpen(false)}
            className={ITEM}
          >
            <it.icon className="h-4 w-4 text-muted-foreground" />
            {it.label}
          </Link>
        ))}
        {onCancel && live && (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onCancel(job);
            }}
            className={`${ITEM} text-danger hover:bg-danger-soft`}
          >
            <Ban className="h-4 w-4" />
            ยกเลิกงาน
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** ยกเลิกงาน: the reason is required (≤ 200) and shown in the job's ประวัติการแก้ไข — `openCancel(job)`, render `modal` */
export function useJobCancelModal(onDone: () => void) {
  const { push } = useToast();
  const [job, setJob] = React.useState<Job | null>(null);
  const [reason, setReason] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const openCancel = (j: Job) => {
    setReason('');
    setJob(j);
  };
  const submit = async () => {
    if (!job) return;
    setSaving(true);
    try {
      await postJson('/api/admin/records', { table: 'jobs', id: job.no, status: 'DELETED', remark: reason });
      push({ kind: 'success', title: 'ยกเลิกงานแล้ว', desc: job.no });
      setJob(null);
      onDone();
    } catch (e) {
      push({ kind: 'error', title: 'ยกเลิกงานไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };
  const modal = (
    <Modal
      open={!!job}
      onClose={() => setJob(null)}
      title={`ยกเลิกงาน ${job?.no ?? ''}?`}
      description="งานจะเป็นสถานะ ยกเลิกข้อมูล และออกจากรายการงาน (ไม่ได้ลบข้อมูลทิ้ง)"
      size="sm"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={() => setJob(null)}>
            ไม่ยกเลิก
          </Button>
          <Button variant="danger" size="sm" disabled={saving || !reason.trim()} onClick={() => void submit()}>
            ยกเลิกงาน
          </Button>
        </>
      }
    >
      <Field label="เหตุผล" required hint={`${reason.length}/200 ตัวอักษร — แสดงในประวัติการแก้ไขของงาน`}>
        <Textarea rows={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
  return { openCancel, modal };
}
