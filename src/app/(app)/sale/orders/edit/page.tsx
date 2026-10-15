'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Truck } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import {
  SaleOrderForm,
  SO_TONE,
  type SaleOrderFormHandle,
  type SaleOrderLoaded,
} from '@/components/shared/sale-order-form';
import { Section } from '@/components/shared/section';
import { PrintButton } from '@/components/shared/print-button';
import { FormActions, JobLookupBar, VIEW_ONLY } from '@/components/shared/job-form';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { RecordGate } from '@/components/shared/record-gate';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { postJson, errMsg } from '@/lib/api';
import { useRecord } from '@/lib/use-record';
import { useAccess } from '@/lib/use-access';
import { useFormErrors } from '@/lib/use-form-errors';
import { SELF_APPROVE, SELF_APPROVE_SALES } from '@/lib/validation/sale-order';
import { trackingSchema } from '@/lib/validation/stock';

function EditSaleOrder() {
  const { push } = useToast();
  const confirm = useConfirm();
  const { isAdmin, can, userId } = useAccess();
  const sp = useSearchParams();
  const initialNo = sp.get('no') ?? '';
  const form = React.useRef<SaleOrderFormHandle>(null);
  // every record that arrives (loaded or saved) remounts the form with it — the form reads `initial`
  // once, when it mounts, so a new record always starts from a clean form
  const [version, setVersion] = React.useState(0);
  // the number from ?no= opens quietly; the lookup bar's number toasts found / not found
  const {
    data: loaded,
    setData: setLoaded,
    loading,
    error,
    find: load,
  } = useRecord<SaleOrderLoaded>({
    url: (n) => `/api/sale-orders/${encodeURIComponent(n)}`,
    pick: (d: { order: SaleOrderLoaded }) => d.order,
    initial: initialNo,
    onRecord: () => setVersion((v) => v + 1),
    onLoaded: (d) => push({ kind: 'success', title: 'เรียกข้อมูลใบสั่งขายสำเร็จ', desc: d.no }),
    onMissing: (n) => push({ kind: 'error', title: 'ไม่พบใบสั่งขาย', desc: n }),
  });
  const no = loaded?.no ?? '';
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    const p = form.current?.payload();
    if (!p || !no) return; // the save bar only shows once the document is loaded (RecordGate)
    if (!form.current?.validate()) return;
    setSaving(true);
    try {
      const d = await postJson<{ order: SaleOrderLoaded }>('/api/sale-orders', { ...p, no, version: loaded?.version });
      setLoaded(d.order);
      push({ kind: 'success', title: 'บันทึกการแก้ไขใบสั่งขายแล้ว', desc: d.order.no });
    } catch (e) {
      if (!form.current?.fromApi(e)) push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  // ปฏิเสธ / ส่งกลับแก้ไข need a reason (the server refuses without one) — asked in this dialog
  const [asking, setAsking] = React.useState<'deny' | 'reject' | null>(null);
  const [reason, setReason] = React.useState('');
  const LABEL = { approve: 'อนุมัติ', deny: 'ปฏิเสธ', reject: 'ส่งกลับแก้ไข' } as const;

  // อนุมัติ → ตัดสต๊อก (WHO type 4) ทันที ตามพฤติกรรมระบบเดิม
  const decide = async (decision: 'approve' | 'deny' | 'reject', remark = '') => {
    if (!no) return;
    const label = LABEL[decision];
    if (decision === 'approve') {
      const ok = await confirm({
        title: `อนุมัติใบสั่งขาย ${no}?`,
        description: 'ระบบจะตัดสต๊อกตามรายการในใบทันที (สร้างเอกสารจ่ายออก WHO) และแก้ไขรายการไม่ได้อีก',
        confirmLabel: 'อนุมัติ (ตัดสต๊อก)',
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const d = await postJson<{ order: SaleOrderLoaded }>(`/api/sale-orders/${encodeURIComponent(no)}/approve`, {
        decision,
        remark,
      });
      setLoaded(d.order);
      setAsking(null);
      setReason('');
      push({ kind: 'success', title: `${label}แล้ว`, desc: `${d.order.no} · ${d.order.approve}` });
    } catch (e) {
      push({ kind: 'error', title: `${label}ไม่สำเร็จ`, desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  // เลขพัสดุ — only on an approved order (POST /api/sale-orders/:no/tracking; the server checks the format)
  const [tracking, setTracking] = React.useState('');
  const [trackingOf, setTrackingOf] = React.useState<SaleOrderLoaded | null>(null);
  const te = useFormErrors(); // a bad parcel no. → under the box, with the allowed format
  if (loaded !== trackingOf) {
    setTrackingOf(loaded);
    setTracking(loaded?.tracking ?? '');
  }
  const saveTracking = async () => {
    if (te.report(te.run(trackingSchema(loaded?.tracking), { tracking }))) return;
    setSaving(true);
    try {
      const d = await postJson<{ order: SaleOrderLoaded }>(`/api/sale-orders/${encodeURIComponent(no)}/tracking`, {
        tracking,
      });
      setLoaded(d.order);
      push({ kind: 'success', title: 'บันทึกเลขพัสดุแล้ว', desc: d.order.tracking || no });
    } catch (e) {
      if (!te.fromApi(e)) push({ kind: 'error', title: 'บันทึกเลขพัสดุไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  // 4 อนุมัติแล้ว / 5 ปฏิเสธ are final — the server refuses any change, so no save or decision buttons
  const approveId = loaded?.approveId ?? 0;
  const closed = [4, 5].includes(approveId);
  // only a waiting order is decided, and not by its creator (System Admin may) — the server checks the same
  const isCreator = !isAdmin && !!userId && (loaded?.creatorIds ?? []).includes(userId);
  const selfReason = !isCreator ? '' : userId === loaded?.createdById ? SELF_APPROVE : SELF_APPROVE_SALES;
  const canApprove = (isAdmin || can('Sale Order', 'edit')) && !isCreator;
  const decided = approveId === 3 || approveId === 5; // the reason banner
  const canEditTracking = isAdmin || can('Sale Order', 'edit');

  return (
    <>
      <PageHeader title="แก้ไขใบสั่งขาย" description="เมนูขาย » ใบสั่งขาย" />
      <JobLookupBar
        id="so-no"
        label="ระบุ เลขใบสั่งขาย (SO)"
        placeholder="SO2600760"
        initial={initialNo}
        onFind={(v) => load(v)}
      />
      <RecordGate ready={!!loaded} loading={loading} error={error} noun="ใบสั่งขาย" searchId="so-no">
        {loaded && (
          <div className="surface flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">สถานะ</span>
              <Badge tone={SO_TONE[loaded.approve] ?? 'neutral'} dot className="px-3 py-1 text-sm">
                {loaded.approve}
              </Badge>
              {approveId === 2 && !canApprove && (
                <span className="text-muted-foreground">
                  รออนุมัติจาก: {loaded.approverRoles?.join(', ') || 'System Admin'}
                  {selfReason && ` — ${selfReason.split(' — ')[0]}`}
                </span>
              )}
              {approveId === 1 && userId !== loaded.createdById && (
                <span className="text-muted-foreground">รอผู้สร้างกด ส่งขออนุมัติ</span>
              )}
              {approveId === 4 && loaded.approvedBy && (
                <span className="text-muted-foreground">
                  โดย {loaded.approvedBy} วันที่ {loaded.approveDate}
                </span>
              )}
            </div>
            {decided && (
              <p role="note" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                {approveId === 3 ? 'ส่งกลับแก้ไข' : 'ปฏิเสธ'}: {loaded.approveRemark || '(ไม่ได้ระบุเหตุผล)'}
                {loaded.approvedBy && ` — โดย ${loaded.approvedBy}`}
                {loaded.approveDate && ` วันที่ ${loaded.approveDate}`}
              </p>
            )}
          </div>
        )}
        <SaleOrderForm key={version} ref={form} soNo={no || undefined} initial={loaded} />
        {approveId === 4 && (
          <Section title="เลขพัสดุ (Tracking)" icon={Truck}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label="เลขพัสดุ" className="flex-1 sm:max-w-xs" error={te.errors.tracking}>
                <Input
                  maxLength={50}
                  value={tracking}
                  onChange={(e) => {
                    setTracking(e.target.value);
                    te.clear('tracking');
                  }}
                  disabled={!canEditTracking}
                  className="num"
                />
              </Field>
              {canEditTracking && (
                <Button
                  size="md"
                  type="button"
                  onClick={saveTracking}
                  disabled={saving || tracking.trim() === (loaded?.tracking ?? '')}
                >
                  บันทึกเลขพัสดุ
                </Button>
              )}
            </div>
          </Section>
        )}
        <FormActions
          saveLabel="บันทึกการแก้ไข"
          onSave={save}
          saving={saving}
          cancelHref="/sale/orders"
          denied={
            closed
              ? `ใบสั่งขาย${loaded?.approve ?? ''} — แก้ไขไม่ได้`
              : can('Sale Order', 'edit')
                ? undefined
                : VIEW_ONLY
          }
          extra={
            <>
              <PrintButton
                label="พิมพ์ใบสั่งขาย"
                kind="sale_order"
                no={no ?? ''}
                profileId={loaded?.documentProfileId}
                href={`/print/sale-order/${encodeURIComponent(no ?? '')}`}
                disabled={!no}
              />
              {loaded && approveId === 2 && canApprove ? (
                <>
                  <Button
                    variant="outline"
                    size="md"
                    type="button"
                    onClick={() => setAsking('reject')}
                    disabled={saving}
                  >
                    ส่งกลับแก้ไข
                  </Button>
                  <Button variant="outline" size="md" type="button" onClick={() => setAsking('deny')} disabled={saving}>
                    ปฏิเสธ
                  </Button>
                  <Button size="md" type="button" onClick={() => decide('approve')} disabled={saving}>
                    อนุมัติ (ตัดสต๊อก)
                  </Button>
                </>
              ) : null}
            </>
          }
        />
      </RecordGate>
      <Modal
        open={!!asking}
        onClose={() => setAsking(null)}
        title={asking ? `${LABEL[asking]}ใบสั่งขาย ${no}` : ''}
        description={
          asking === 'deny'
            ? 'ใบนี้จะถูกปฏิเสธ ไม่ตัดสต๊อก และอนุมัติภายหลังไม่ได้'
            : 'ใบจะถูกส่งกลับให้ผู้สร้างแก้ไข แล้วส่งขออนุมัติใหม่'
        }
        size="sm"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setAsking(null)}>
              ยกเลิก
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={saving || !reason.trim()}
              onClick={() => asking && decide(asking, reason)}
            >
              {asking ? LABEL[asking] : ''}
            </Button>
          </>
        }
      >
        <Field label="เหตุผล" required hint="ทุกคนที่เปิดใบนี้จะเห็นเหตุผลนี้">
          <Textarea rows={3} maxLength={100} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      </Modal>
    </>
  );
}

export default function EditSaleOrderPage() {
  return (
    <React.Suspense fallback={null}>
      <EditSaleOrder />
    </React.Suspense>
  );
}
