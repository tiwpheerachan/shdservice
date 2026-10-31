'use client';

import { PackageCheck, ClipboardList } from 'lucide-react';
import { Section } from '@/components/shared/section';
import { useJobForm } from '@/components/shared/job-form';
import { Badge } from '@/components/ui/badge';
import { Field, FieldGrid, ReadOnly, type Lookup } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { RETURN_METHODS, CLOSE_STATUS_OPTIONS } from '@/data/options';
import { useShippingProfiles } from '@/data/db';
import type { JobDetail } from '@/lib/use-job';
import { SEND_STATUS } from '@/lib/outsource-status';
import { trackingAccepts, type FieldErrors } from '@/lib/validation';
import { CodeInput } from '@/components/shared/code-input';
import {
  isSwap,
  noteMaxLength,
  returnDetailOf,
  serialAccepts,
  OUTSOURCE_NOT_BACK,
  STATUS_CLOSED_TRACKED,
  STATUS_CLOSED_WAIT_TRACKING,
} from '@/lib/validation/job';
import type { CloseDraft } from './close-money';

export function CloseJobInfoSection({ job }: { job: JobDetail | null }) {
  return (
    <Section title="ข้อมูลการเปิดงาน" icon={ClipboardList}>
      <FieldGrid>
        <Field label="หมายเลขงาน">
          <ReadOnly>
            <span className="num">{job?.no ?? '—'}</span>
          </ReadOnly>
        </Field>
        <Field label="วันที่เปิดงาน">
          <ReadOnly>
            <span className="num">{job ? `${job.createDate} น.` : '—'}</span>
          </ReadOnly>
        </Field>
        <Field label="ประเภทงาน">
          <ReadOnly>
            {job
              ? `${job.jobType}${job.warranty ? ` (${job.warranty === 'IN' ? 'In-Warranty' : 'Out-Warranty'})` : ''}`
              : '—'}
          </ReadOnly>
        </Field>
        <Field label="สถานะงาน (ปัจจุบัน)">
          <ReadOnly>
            <Badge tone="success" dot>
              {job?.status ?? '—'}
            </Badge>
          </ReadOnly>
        </Field>
      </FieldGrid>
    </Section>
  );
}

export function CloseWorkSection({ job }: { job: JobDetail | null }) {
  const { s: form } = useJobForm();
  return (
    <Section title="รายละเอียดการดำเนินงาน" icon={ClipboardList}>
      <FieldGrid>
        <Field label="อาการเสีย (มาตรฐาน)" className="lg:col-span-2">
          <Textarea rows={2} readOnly value={form.symptoms.join(', ')} />
        </Field>
        <Field label="วิธีการซ่อมที่ดำเนินการ" className="lg:col-span-2">
          <Textarea rows={2} readOnly value={job?.repairDetail ?? ''} />
        </Field>
        <Field label="ช่างผู้รับผิดชอบ">
          <ReadOnly>{job?.engineer || '—'}</ReadOnly>
        </Field>
        <Field label="วันที่ซ่อมเสร็จ">
          <ReadOnly>
            <span className="num">{job?.repairedDate || '—'}</span>
          </ReadOnly>
        </Field>
      </FieldGrid>
    </Section>
  );
}

export function CloseReturnSection({
  job,
  d,
  upd,
  errors,
  partsWait,
  shippers,
  shippersLookup,
}: {
  job: JobDetail | null;
  d: CloseDraft;
  upd: (p: Partial<CloseDraft>) => void;
  errors: FieldErrors;
  /** why the close is refused while a part requested from stock is not issued */
  partsWait?: string;
  /** courier names (the free-text suggestions) — the page reads them to prefill the courier */
  shippers: string[];
  shippersLookup: Lookup;
}) {
  const { data: SHIPPING, ...shippingLookup } = useShippingProfiles();
  // still at the out-source vendor → the server refuses the close; say so before the user fills the form
  const outsourceOut = !!job?.outsource.some((o) => o.status === SEND_STATUS.SENT);
  // the save puts the courier in front of the note (one varchar(100))
  const returnDetailMax = noteMaxLength((n) => returnDetailOf(d.courier, n), d.returnDetail);

  return (
    <Section title="ข้อมูลการปิดงาน - ส่งคืนสินค้า" icon={PackageCheck}>
      <FieldGrid>
        <Field label="วิธีการส่งคืนสินค้า" required error={errors['return.type']}>
          <Select value={d.returnType} onChange={(e) => upd({ returnType: e.target.value })}>
            <option value="">- - เลือก - -</option>
            {RETURN_METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
            {d.returnType && !RETURN_METHODS.includes(d.returnType) && <option>{d.returnType}</option>}
          </Select>
        </Field>
        <Field label="วันที่ส่งคืน" required error={errors['return.date']}>
          <Input type="date" value={d.returnDate} onChange={(e) => upd({ returnDate: e.target.value })} />
        </Field>
        <Field
          label="บริษัทขนส่ง"
          lookup={[shippingLookup, shippersLookup]}
          hint={d.shipperId ? 'ลูกค้าจะเห็นโลโก้และปุ่มติดตามพัสดุในหน้าติดตามสถานะ' : undefined}
        >
          {/* โปรไฟล์บริษัทขนส่ง (ข้อมูลระบบ) — เลือก "อื่น ๆ" เพื่อพิมพ์ชื่อเองแบบระบบเดิม */}
          <Select
            value={d.shipperId || (d.courier ? 'other' : '')}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'other') return upd({ shipperId: '', courier: '' });
              const p = SHIPPING.find((x) => x.id === v);
              upd({ shipperId: p ? p.id : '', courier: p ? p.nameTh : '' });
            }}
          >
            <option value="">- - เลือก - -</option>
            {/* a profile deleted since (hidden from the list): the job keeps it */}
            {d.shipperId && !SHIPPING.some((p) => p.id === d.shipperId) && (
              <option value={d.shipperId}>{d.courier || 'โปรไฟล์ที่ถูกลบ'} (ค่าเดิม)</option>
            )}
            {SHIPPING.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nameTh}
              </option>
            ))}
            <option value="other">อื่น ๆ (พิมพ์เอง)</option>
          </Select>
          {!d.shipperId && (
            <Input
              className="mt-2"
              list="close-shipper-options"
              maxLength={50}
              value={d.courier}
              onChange={(e) => upd({ courier: e.target.value })}
              placeholder="พิมพ์ชื่อบริษัทขนส่ง"
              aria-label="ชื่อบริษัทขนส่ง (พิมพ์เอง)"
            />
          )}
          <datalist id="close-shipper-options">
            {shippers.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="หมายเลขพัสดุ" required={d.status === STATUS_CLOSED_TRACKED} error={errors['return.tracking']}>
          <CodeInput
            className="num"
            maxLength={50}
            value={d.tracking}
            onChange={(e) => upd({ tracking: e.target.value })}
            accepts={trackingAccepts}
            onFix={(v) => upd({ tracking: v })}
          />
        </Field>
        {/* a swap job: the new device's serial may be entered / corrected here — optional */}
        {job && isSwap(job.swap.detail) && (
          <Field label="Serial เครื่องใหม่" error={errors.newSerial} hint="พิมพ์ในใบส่งคืนสินค้า (New S/N)">
            <CodeInput
              className="num"
              maxLength={50}
              value={d.newSerial}
              onChange={(e) => upd({ newSerial: e.target.value })}
              accepts={serialAccepts}
              onFix={(v) => upd({ newSerial: v })}
            />
          </Field>
        )}
        <Field
          label="รายละเอียดการส่งคืน"
          wide
          error={errors['return.detail']}
          hint={`${d.returnDetail.length}/${returnDetailMax} ตัวอักษร${d.courier ? ' (บันทึกพร้อมชื่อบริษัทขนส่ง)' : ''}`}
        >
          <Textarea
            rows={2}
            maxLength={returnDetailMax}
            value={d.returnDetail}
            onChange={(e) => upd({ returnDetail: e.target.value })}
          />
        </Field>
        <Field
          label="โปรดระบุ สถานะงาน"
          required
          wide
          error={errors.status ?? (outsourceOut ? OUTSOURCE_NOT_BACK : partsWait)}
          hint={
            d.status === STATUS_CLOSED_WAIT_TRACKING && d.tracking.trim()
              ? `มีหมายเลขพัสดุแล้ว — บันทึกเป็น "${STATUS_CLOSED_TRACKED}"`
              : undefined
          }
        >
          <Select value={d.status} onChange={(e) => upd({ status: e.target.value })}>
            <option value="">- - เลือก - -</option>
            {CLOSE_STATUS_OPTIONS.map((st) => (
              <option key={st}>{st}</option>
            ))}
          </Select>
        </Field>
      </FieldGrid>
    </Section>
  );
}
