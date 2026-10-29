'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { QuotationForm, type QuotationFormHandle, type QuotationLoaded } from '@/components/shared/quotation-form';
import { PrintButton } from '@/components/shared/print-button';
import { FormActions, JobLookupBar, VIEW_ONLY } from '@/components/shared/job-form';
import { RecordGate } from '@/components/shared/record-gate';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { Badge } from '@/components/ui/badge';
import { api, postJson, errMsg } from '@/lib/api';
import { useRecord } from '@/lib/use-record';
import { quotationKey, recordNo } from '@/data/keys';
import { useAccess } from '@/lib/use-access';
import { quoteJobNote } from '@/lib/quote-job';
import { quoteExpired } from '@/lib/quote-expiry';
import { QUOTE_VALID_DAYS } from '@/lib/company';
import { profileLock } from '@/lib/profile-lock';

function EditQuotation() {
  const { push } = useToast();
  const confirm = useConfirm();
  const { can } = useAccess();
  const sp = useSearchParams();
  const initialId = sp.get('id') ?? ''; // the quotation's uuid (ADR 0008)
  const form = React.useRef<QuotationFormHandle>(null);
  // every record that arrives (loaded or saved) remounts the form with it — the form reads `initial`
  // once, when it mounts, so a new record always starts from a clean form
  const [version, setVersion] = React.useState(0);
  // the quotation from ?id= opens quietly; the lookup bar's number toasts found / not found
  const {
    data: loaded,
    setData: setLoaded,
    loading,
    error,
    find: load,
    reload,
  } = useRecord<QuotationLoaded>({
    url: quotationKey,
    pick: (d: { quotation: QuotationLoaded }) => d.quotation,
    initial: initialId,
    onRecord: () => setVersion((v) => v + 1),
    onLoaded: (d) => {
      push({ kind: 'success', title: 'เรียกข้อมูลใบเสนอราคาสำเร็จ', desc: d.no });
      window.history.replaceState(null, '', `?id=${d.id}`); // a refresh keeps this one
    },
    onMissing: (_, message) => push({ kind: 'error', title: 'ไม่พบใบเสนอราคา', desc: message }),
  });
  // the lookup bar takes the number (Q…): found through the list, then opened by its uuid
  const lookUp = async (v: string) => {
    const typed = recordNo(v);
    if (!typed) return;
    try {
      const rows = await api<{ id: string; no: string }[]>(
        `/api/data/quotations?no=${encodeURIComponent(typed)}&deleted=all&limit=50`,
      );
      const hit = rows.find((r) => r.no === typed);
      if (hit) load(hit.id);
      else push({ kind: 'error', title: 'ไม่พบใบเสนอราคา', desc: typed });
    } catch (e) {
      push({ kind: 'error', title: 'ค้นหาใบเสนอราคาไม่สำเร็จ', desc: errMsg(e) });
    }
  };
  const no = loaded?.no ?? '';
  const [saving, setSaving] = React.useState(false);
  // sent and past its validity — the list shows it as พ้นกำหนดเสนอราคา (same rule: src/lib/quote-expiry.ts)
  const expired = !!loaded && quoteExpired(loaded.statusId, loaded.date, loaded.job?.statusId ?? null);

  const save = async () => {
    const p = form.current?.payload();
    if (!p || !no) return; // the save bar only shows once the document is loaded (RecordGate)
    if (!form.current?.validate()) return;
    // the customer answers an expired quotation: only on purpose (the old price may no longer hold)
    if (
      expired &&
      p.status !== loaded?.status &&
      p.status.startsWith('ลูกค้าตกลงซ่อม') &&
      !(await confirm({
        title: 'ใบเสนอราคานี้พ้นกำหนดแล้ว',
        description: `ออกเมื่อ ${loaded?.date} เกินระยะยืนราคา ${QUOTE_VALID_DAYS} วัน — ยืนยันว่าลูกค้าตกลงซ่อมตามราคาในใบนี้?`,
        confirmLabel: 'ยืนยัน ลูกค้าตกลงซ่อม',
      }))
    )
      return;
    setSaving(true);
    try {
      const d = await postJson<{ quotation: QuotationLoaded }>('/api/quotations', {
        ...p,
        no,
        version: loaded?.version,
      });
      setLoaded(d.quotation);
      push({ kind: 'success', title: 'บันทึกการแก้ไขใบเสนอราคาแล้ว', desc: d.quotation.no });
      // a new status that leaves the job where it is says so (the saved job is the one after the save)
      const note = p.status !== loaded?.status ? quoteJobNote(p.status, d.quotation.job) : '';
      if (note) push({ kind: 'info', title: 'สถานะงานไม่เปลี่ยน', desc: note });
    } catch (e) {
      if (!form.current?.fromApi(e, () => void reload()))
        push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="แก้ไขใบเสนอราคา"
        description="ระบุหมายเลขใบเสนอราคาเพื่อเรียกข้อมูลมาแก้ไข"
        actions={
          expired && (
            <Badge tone="danger" dot>
              พ้นกำหนดเสนอราคา
            </Badge>
          )
        }
      />
      <JobLookupBar
        id="quotation-no"
        label="ระบุ หมายเลขใบเสนอราคา"
        placeholder="Q2600462"
        initial={loaded?.no ?? ''}
        onFind={(v) => void lookUp(v)}
      />
      <RecordGate ready={!!loaded} loading={loading} error={error} noun="ใบเสนอราคา" searchId="quotation-no">
        <QuotationForm key={version} ref={form} mode="edit" quotationNo={no || undefined} initial={loaded} />
        <FormActions
          saveLabel="บันทึกการแก้ไข"
          onSave={save}
          saving={saving}
          cancelHref="/quotation/list"
          denied={
            loaded?.active === false
              ? 'ใบเสนอราคานี้ถูกยกเลิก (ลบ) แล้ว — แก้ไขและพิมพ์ไม่ได้'
              : can('Quotation', 'edit')
                ? undefined
                : VIEW_ONLY
          }
          extra={
            <PrintButton
              label="พิมพ์ใบเสนอราคา"
              kind="quotation"
              locked={profileLock('quotation', { statusId: loaded?.statusId })}
              no={no ?? ''}
              profileId={loaded?.documentProfileId}
              href={`/print/quotation/${loaded?.id ?? ''}`}
              disabled={!no || loaded?.active === false}
            />
          }
        />
      </RecordGate>
    </>
  );
}

export default function EditQuotationPage() {
  return (
    <React.Suspense fallback={null}>
      <EditQuotation />
    </React.Suspense>
  );
}
