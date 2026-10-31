'use client';

import * as React from 'react';
import { Wrench } from 'lucide-react';
import { Section } from '@/components/shared/section';
import { useJobForm, useSymptomLists } from '@/components/shared/job-form';
import { SearchSelect, strOptions } from '@/components/shared/search-select';
import { SymptomPicker } from '@/components/shared/symptom-picker';
import { Badge } from '@/components/ui/badge';
import { Field, FieldGrid, ReadOnly } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { REPAIR_STATUS_OPTIONS } from '@/data/options';
import { useAccess } from '@/lib/use-access';
import type { JobDetail } from '@/lib/use-job';
import type { FieldErrors } from '@/lib/validation';
import { REOPEN_LOCKED } from '@/lib/validation/job';

export type RepairDetail = {
  engineerSymptom: string;
  repairDetail: string;
  engineerRemark: string;
  newSerial: string;
  status: string;
};

export function RepairJobInfoSection({ job }: { job: JobDetail | null }) {
  return (
    <Section title="ข้อมูลการเปิดงานซ่อม" icon={Wrench}>
      <FieldGrid>
        <Field label="หมายเลขงานซ่อม">
          <ReadOnly>
            <span className="num">{job?.no ?? '—'}</span>
          </ReadOnly>
        </Field>
        <Field label="วันที่เปิดงานซ่อม">
          <ReadOnly>
            <span className="num">{job ? `${job.createDate} น.` : '—'}</span>
          </ReadOnly>
        </Field>
        <Field label="เปิดงานซ่อมโดย">
          <ReadOnly>{job?.createByName || '—'}</ReadOnly>
        </Field>
        <Field label="ประเภทงานซ่อม">
          <ReadOnly>
            {job
              ? `${job.jobType}${job.warranty ? ` (${job.warranty === 'IN' ? 'In-Warranty' : 'Out-Warranty'})` : ''}`
              : '—'}
          </ReadOnly>
        </Field>
        <Field label="สถานะงานซ่อม (ปัจจุบัน)" wide>
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

export function RepairDetailSection({
  job,
  detail,
  setDetail,
  act,
  partsBlock,
}: {
  job: JobDetail | null;
  detail: RepairDetail;
  setDetail: React.Dispatch<React.SetStateAction<RepairDetail>>;
  act: { errors: FieldErrors; clear: (key: string) => void };
  /** why the chosen status is refused while parts are not issued */
  partsBlock?: string;
}) {
  const { s: form } = useJobForm();
  const symptomLists = useSymptomLists(form.modelCode);
  const { has } = useAccess();
  // a closed job keeps its status unless the role has Job Reopen (setStatus refuses it otherwise)
  const reopenLock = form.statusGroup === 'Finished' && !has('Job Reopen') ? REOPEN_LOCKED : undefined;
  // a closed job keeps its status (Job Reopen may re-open it: setStatus); otherwise its own one comes first
  const statusOptions =
    reopenLock && job
      ? [job.status]
      : job && !REPAIR_STATUS_OPTIONS.includes(job.status)
        ? [job.status, ...REPAIR_STATUS_OPTIONS]
        : REPAIR_STATUS_OPTIONS;

  return (
    <Section title="รายละเอียดการซ่อม" icon={Wrench}>
      <FieldGrid>
        <Field label="อาการเสียที่ตรวจพบ" wide hint="เลือกได้ 1 อาการ" lookup={symptomLists.lookup}>
          <SymptomPicker
            multiple={false}
            value={detail.engineerSymptom ? [detail.engineerSymptom] : []}
            onChange={(names) => setDetail((d) => ({ ...d, engineerSymptom: names[0] ?? '' }))}
            {...symptomLists.picker}
            suggestedLabel="อาการที่พบบ่อยของรุ่นนี้"
            placeholder="พิมพ์ค้นหาอาการที่ตรวจพบ…"
          />
        </Field>
        <Field label="วิธีการซ่อม" className="lg:col-span-2" error={act.errors.repairDetail}>
          <Textarea
            rows={3}
            maxLength={200}
            placeholder="อธิบายขั้นตอนการซ่อมที่ดำเนินการ"
            value={detail.repairDetail}
            onChange={(e) => {
              setDetail((d) => ({ ...d, repairDetail: e.target.value }));
              act.clear('repairDetail');
            }}
          />
        </Field>
        <Field label="หมายเหตุ" className="lg:col-span-2" error={act.errors.engineerRemark}>
          <Textarea
            rows={3}
            maxLength={200}
            value={detail.engineerRemark}
            onChange={(e) => {
              setDetail((d) => ({ ...d, engineerRemark: e.target.value }));
              act.clear('engineerRemark');
            }}
          />
        </Field>
        {job?.sparePartReplace && (
          <Field label="อะไหล่ที่เปลี่ยน / New S/N (ที่บันทึกไว้)" wide>
            <Textarea rows={2} readOnly value={job.sparePartReplace} />
          </Field>
        )}
        <Field
          label="New Serial No."
          error={act.errors.newSerial}
          hint="เพิ่มต่อท้ายรายการอะไหล่ที่เปลี่ยน (ของเดิมไม่หาย)"
        >
          <Input
            className="num"
            maxLength={50}
            value={detail.newSerial}
            onChange={(e) => {
              setDetail((d) => ({ ...d, newSerial: e.target.value }));
              act.clear('newSerial');
            }}
          />
        </Field>
        <Field label="สถานะงานซ่อม" required error={act.errors.status ?? partsBlock} hint={reopenLock}>
          <SearchSelect
            value={detail.status}
            onChange={(v) => {
              setDetail((d) => ({ ...d, status: v }));
              act.clear('status');
            }}
            options={strOptions(statusOptions)}
            minWidth={360}
            searchPlaceholder="พิมพ์ชื่อสถานะ…"
          />
        </Field>
      </FieldGrid>
    </Section>
  );
}
