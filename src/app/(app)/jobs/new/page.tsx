'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import {
  CustomerSection,
  JobOpenSection,
  ProductSection,
  OtherInfoSection,
  AttachmentSection,
  FormActions,
  JobFormProvider,
  useJobForm,
  toJobInput,
  type AttachmentsHandle,
} from '@/components/shared/job-form';
import { useToast } from '@/components/ui/toast';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { TrackLink } from '@/components/shared/track-link';
import { postJson, errMsg } from '@/lib/api';
import { useAccess } from '@/lib/use-access';
import type { JobDetail } from '@/lib/use-job';

function NewJobForm() {
  const { push } = useToast();
  const router = useRouter();
  const { s, reset, validate, report, fromApi } = useJobForm();
  const attach = React.useRef<AttachmentsHandle>(null);
  const [saving, setSaving] = React.useState(false);
  const { can } = useAccess();
  const canRepair = can('Job Repair', 'edit');
  // after saving we stop here first so the tracking link can be copied and sent
  // to the customer right away (the job is trackable from the moment it exists)
  const [opened, setOpened] = React.useState<{ id: string; no: string } | null>(null);

  const save = async () => {
    if (report(validate())) return;
    setSaving(true);
    try {
      const d = await postJson<{ job: JobDetail }>('/api/jobs', toJobInput(s));
      await attach.current?.uploadPending(d.job.no);
      push({ kind: 'success', title: 'เปิดงานใหม่เรียบร้อย', desc: `หมายเลขงาน ${d.job.no}` });
      reset();
      setOpened({ id: d.job.id, no: d.job.no });
    } catch (e) {
      if (!fromApi(e)) push({ kind: 'error', title: 'เปิดงานไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="เปิดงานใหม่"
        description="ข้อมูลงานบริการ » เปิดงานใหม่ — กรอกข้อมูลลูกค้า สินค้า และอาการเสีย"
      />
      <CustomerSection />
      <JobOpenSection status="งานใหม่" />
      <ProductSection variant="open" />
      <OtherInfoSection />
      <AttachmentSection ref={attach} />
      <FormActions
        saveLabel="บันทึกเปิดงาน"
        onSave={save}
        saving={saving}
        cancelHref="/jobs/list"
        denied={can('Job Management', 'add') ? undefined : 'ไม่มีสิทธิ์เปิดงานใหม่ — ติดต่อผู้ดูแลระบบ'}
      />

      <Modal
        open={!!opened}
        onClose={() => setOpened(null)}
        title={`เปิดงานเรียบร้อย · ${opened?.no ?? ''}`}
        description="พิมพ์ใบรับงานให้ลูกค้า และส่งลิงก์ติดตามงานได้เลย"
        footer={
          <>
            {/* the repair screen is the technician's — offered only to a role that may save it */}
            {canRepair && (
              <Button variant="ghost" size="sm" onClick={() => opened && router.push(`/jobs/repair?id=${opened.id}`)}>
                ไปบันทึกงานซ่อม
              </Button>
            )}
            {/* the form is already empty for the next customer */}
            <Button variant="outline" size="sm" onClick={() => setOpened(null)}>
              เปิดงานใหม่อีกงาน
            </Button>
            <Button size="sm" data-autofocus onClick={() => opened && window.open(`/print/job/${opened.id}`, '_blank')}>
              พิมพ์ใบรับงาน
            </Button>
          </>
        }
      >
        {opened && <TrackLink jobId={opened.id} compact />}
      </Modal>
    </>
  );
}

export default function NewJobPage() {
  return (
    <JobFormProvider>
      <NewJobForm />
    </JobFormProvider>
  );
}
