'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { QuotationForm, type QuotationFormHandle } from '@/components/shared/quotation-form';
import { FormActions, VIEW_ONLY } from '@/components/shared/job-form';
import { useToast } from '@/components/ui/toast';
import { postJson, errMsg } from '@/lib/api';
import { useAccess } from '@/lib/use-access';

function NewQuotation() {
  const { push } = useToast();
  const { can } = useAccess();
  const router = useRouter();
  const sp = useSearchParams();
  const form = React.useRef<QuotationFormHandle>(null);
  const [saving, setSaving] = React.useState(false);

  // POST /api/quotations → quotation_hd (running Q) + quotation_dt
  const save = async () => {
    const p = form.current?.payload();
    if (!p || !form.current?.validate()) return; // every field error at once (the API checks the same)
    setSaving(true);
    try {
      const d = await postJson<{ quotation: { id: string; no: string } }>('/api/quotations', p);
      push({ kind: 'success', title: 'สร้างใบเสนอราคาแล้ว', desc: d.quotation.no });
      router.push(`/quotation/edit?id=${d.quotation.id}`);
    } catch (e) {
      if (!form.current?.fromApi(e)) push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="สร้างใบเสนอราคา" description="ข้อมูลการเสนอราคา » เสนอราคางานซ่อม" />
      <QuotationForm ref={form} mode="new" jobId={sp.get('job') ?? undefined} />
      <FormActions
        saveLabel="บันทึกใบเสนอราคา"
        onSave={save}
        saving={saving}
        cancelHref="/quotation/list"
        denied={can('Quotation', 'add') ? undefined : VIEW_ONLY}
      />
    </>
  );
}

export default function NewQuotationPage() {
  return (
    <React.Suspense fallback={null}>
      <NewQuotation />
    </React.Suspense>
  );
}
