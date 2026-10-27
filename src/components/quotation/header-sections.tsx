'use client';

import * as React from 'react';
import Link from 'next/link';
import { FileText, UserRound, Wrench } from 'lucide-react';
import { Section } from '@/components/shared/section';
import { CustomerSelect } from '@/components/shared/customer-select';
import { ProfileSelect } from '@/components/shared/profile-select';
import { Badge } from '@/components/ui/badge';
import { Field, FieldGrid, ReadOnly } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import type { Customer } from '@/data/types';
import type { JobDetail } from '@/lib/use-job';
import type { FieldErrors } from '@/lib/validation';

type QuoteType = 'A' | 'B';

/** ประเภทใบเสนอราคา — ออกเอกสารในนาม + Type A (Normal) / Type B (VIP) */
export function QuotationTypeSection({
  type,
  onType,
  profileId,
  onProfile,
  docNo,
  profileLocked,
}: {
  type: QuoteType;
  onType: (t: QuoteType) => void;
  profileId: number;
  onProfile: React.ComponentProps<typeof ProfileSelect>['onChange'];
  /** the quotation's number once it has one */
  docNo?: string;
  /** why its ออกเอกสารในนาม is fixed (profileLock) */
  profileLocked?: string;
}) {
  return (
    <Section
      title="ประเภทใบเสนอราคา"
      icon={FileText}
      actions={<Badge tone="primary">{type === 'A' ? 'Type A (Normal)' : 'Type B (VIP)'}</Badge>}
    >
      <div className="mb-3 sm:max-w-md">
        <ProfileSelect
          value={profileId}
          onChange={onProfile}
          doc={docNo ? { kind: 'quotation', no: docNo } : undefined}
          locked={profileLocked}
        />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {(['A', 'B'] as const).map((t) => (
          <button
            key={t}
            onClick={() => onType(t)}
            className={
              'flex-1 rounded-lg border px-4 py-3 text-left transition-colors ' +
              (type === t ? 'border-primary bg-primary-soft' : 'border-border bg-card hover:border-input')
            }
          >
            <p className={'text-sm font-medium ' + (type === t ? 'text-primary' : '')}>
              {t === 'A' ? 'Type A (Normal)' : 'Type B (VIP)'}
            </p>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              {t === 'A' ? 'ราคามาตรฐานสำหรับลูกค้าทั่วไป' : 'ราคาพิเศษสำหรับลูกค้า VIP / คู่ค้า'}
            </p>
          </button>
        ))}
      </div>
    </Section>
  );
}

/** ข้อมูลลูกค้า — the customer + the contact name */
export function QuotationCustomerSection({
  customer,
  setCustomer,
  contact,
  setContact,
  errors,
}: {
  customer: Customer | null;
  setCustomer: (c: Customer | null) => void;
  contact: string;
  setContact: (v: string) => void;
  errors: FieldErrors;
}) {
  return (
    <Section
      title="ข้อมูลลูกค้า"
      icon={UserRound}
      description={
        customer ? 'ข้อมูลกลางจากตารางลูกค้า (อ่านอย่างเดียว)' : 'เลือก ลูกค้าเดิม เพื่อค้นหา หรือ ลูกค้าใหม่'
      }
    >
      <Field error={errors.customerCode}>
        <CustomerSelect value={customer} onChange={setCustomer} />
      </Field>
      <FieldGrid className="mt-4">
        <Field label="ชื่อผู้ติดต่อ" className="lg:col-span-2" error={errors.contactName}>
          <Input maxLength={100} value={contact} onChange={(e) => setContact(e.target.value)} />
        </Field>
      </FieldGrid>
    </Section>
  );
}

/** ข้อมูลใบเสนอราคา — number, date, the job it quotes for (typed + looked up) and that job's status */
export function QuotationInfoSection({
  no,
  date,
  jobRef,
  setJobRef,
  jobRequired,
  jobError,
  onLoadJob,
  job,
  linkJob,
}: {
  /** the number (or "Generate Auto" / "—") */
  no: string;
  date: string;
  jobRef: string;
  setJobRef: (v: string) => void;
  jobRequired: boolean;
  jobError?: string;
  /** Enter / leaving the box: look the typed job up */
  onLoadJob: () => void;
  job: JobDetail | null;
  /** edit page: a link to the job */
  linkJob: boolean;
}) {
  return (
    <Section title="ข้อมูลใบเสนอราคา" icon={FileText}>
      <FieldGrid>
        <Field label="หมายเลขใบเสนอราคา">
          <ReadOnly>
            <span className="num">{no}</span>
          </ReadOnly>
        </Field>
        <Field label="วันที่">
          <ReadOnly>
            <span className="num">{date} น.</span>
          </ReadOnly>
        </Field>
        <Field label="อ้างถึง หมายเลขงานซ่อม" required={jobRequired} error={jobError}>
          <div className="flex items-center gap-2">
            <Input
              className="num"
              placeholder="J2612164"
              maxLength={8}
              value={jobRef}
              onChange={(e) => setJobRef(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onLoadJob()}
              onBlur={() => jobRef && jobRef.toUpperCase() !== job?.no && onLoadJob()}
            />
            {linkJob && job?.no && (
              <Link
                href={`/jobs/edit?job=${encodeURIComponent(job.no)}`}
                className="shrink-0 text-xs text-primary hover:underline"
              >
                เปิดงาน
              </Link>
            )}
          </div>
        </Field>
        <Field label="สถานะงานซ่อม (ปัจจุบัน)">
          <ReadOnly>
            <Badge tone="warning" dot>
              {job?.status ?? '—'}
            </Badge>
          </ReadOnly>
        </Field>
      </FieldGrid>
    </Section>
  );
}

/** ข้อมูลเครื่องซ่อม — the quoted job's device, read-only */
export function QuotationDeviceSection({ job }: { job: JobDetail | null }) {
  return (
    <Section title="ข้อมูลเครื่องซ่อม" icon={Wrench}>
      <FieldGrid>
        <Field label="เลขคำสั่งซื้อ">
          <Input className="num" value={job?.so ?? ''} readOnly />
        </Field>
        <Field label="หมายเลขอ้างอิง (เลขพัสดุ)">
          <Input className="num" value={job?.receptionTrackingNo ?? ''} readOnly />
        </Field>
        <Field label="เปิดงานวันที่">
          <Input value={job?.createDate ?? ''} readOnly className="num" />
        </Field>
        <Field label="IMEI No.">
          <Input className="num" value={job?.imei ?? ''} readOnly />
        </Field>
        <Field label="ประเภทเครื่องซ่อม">
          <Input value={job?.productType ?? ''} readOnly />
        </Field>
        <Field label="ยี่ห้อ">
          <Input value={job?.brand ?? ''} readOnly />
        </Field>
        <Field label="รุ่น">
          <Input value={job ? [job.modelCode, job.modelName].filter(Boolean).join(' — ') : ''} readOnly />
        </Field>
        <Field label="Warranty">
          <Input
            value={
              job?.warranty === 'IN' ? 'In Warranty' : job?.warranty === 'OUT' ? 'Out Warranty' : (job?.warranty ?? '')
            }
            readOnly
          />
        </Field>
        <Field label="อาการเสีย (มาตรฐาน)" className="lg:col-span-2">
          <Textarea rows={2} value={job?.symptoms.join(', ') ?? ''} readOnly />
        </Field>
        <Field label="อาการเสีย (อื่นๆ)" className="lg:col-span-2">
          <Textarea rows={2} value={job?.symptomOther ?? ''} readOnly />
        </Field>
        <Field label="จุดตำหนิ" className="lg:col-span-2">
          <Textarea rows={2} value={job?.fault ?? ''} readOnly />
        </Field>
        <Field label="อุปกรณ์ (ที่นำส่ง)" className="lg:col-span-2">
          <Textarea rows={2} value={job?.equipment ?? ''} readOnly />
        </Field>
      </FieldGrid>
    </Section>
  );
}
