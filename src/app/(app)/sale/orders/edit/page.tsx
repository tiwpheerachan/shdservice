'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { mutate } from 'swr';
import { Truck, Wallet } from 'lucide-react';
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
import { FileInput, Input, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { RecordGate } from '@/components/shared/record-gate';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { ApiError, api, postJson, errMsg, upload } from '@/lib/api';
import { baht } from '@/lib/utils';
import { RecordKey, useRecord } from '@/lib/use-record';
import { recordNo } from '@/data/keys';
import { useAccess } from '@/lib/use-access';
import { useFormErrors } from '@/lib/use-form-errors';
import { SELF_APPROVE, SELF_APPROVE_SALES, SO_CANCELLED, WAITING_CREATOR_ONLY } from '@/lib/validation/sale-order';
import { trackingSchema } from '@/lib/validation/stock';
import { trackingAccepts } from '@/lib/validation';
import { CodeInput } from '@/components/shared/code-input';
import { useTourRestore } from '@/components/tour/tour';
import { profileLock } from '@/lib/profile-lock';

function EditSaleOrder() {
  const { push } = useToast();
  const confirm = useConfirm();
  const { isAdmin, can, has, userId } = useAccess();
  const sp = useSearchParams();
  const initialId = sp.get('id') ?? '';
  const form = React.useRef<SaleOrderFormHandle>(null);
  // every record that arrives (loaded or saved) remounts the form with it — the form reads `initial`
  // once, when it mounts, so a new record always starts from a clean form
  const [version, setVersion] = React.useState(0);
  // the order from ?id= opens quietly; the lookup bar's number toasts found / not found
  const {
    data: loaded,
    setData: setLoaded,
    loading,
    error,
    find: load,
    reload,
  } = useRecord<SaleOrderLoaded>({
    url: (id) => `/api/sale-orders/${encodeURIComponent(id)}`,
    pick: (d: { order: SaleOrderLoaded }) => d.order,
    initial: initialId,
    onRecord: () => setVersion((v) => v + 1),
    onLoaded: (d) => {
      push({ kind: 'success', title: 'เรียกข้อมูลใบสั่งขายสำเร็จ', desc: d.no });
      window.history.replaceState(null, '', `?id=${d.id}`);
    },
    onMissing: (_, message) => push({ kind: 'error', title: 'ไม่พบใบสั่งขาย', desc: message }),
  });
  // the lookup bar takes the number (SO…): found through the list, then opened by its uuid
  const lookUp = async (v: string) => {
    const typed = recordNo(v);
    if (!typed) return;
    try {
      const rows = await api<{ id: string; no: string }[]>(
        `/api/data/sale_orders?no=${encodeURIComponent(typed)}&deleted=all&limit=50`,
      );
      const hit = rows.find((r) => r.no === typed);
      if (hit) load(hit.id);
      else push({ kind: 'error', title: 'ไม่พบใบสั่งขาย', desc: typed });
    } catch (e) {
      push({ kind: 'error', title: 'ค้นหาใบสั่งขายไม่สำเร็จ', desc: errMsg(e) });
    }
  };
  const no = loaded?.no ?? '';
  const id = loaded?.id ?? '';
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    const p = form.current?.payload();
    if (!p || !no) return;
    if (!form.current?.validate()) return;
    setSaving(true);
    try {
      const d = await postJson<{ order: SaleOrderLoaded }>('/api/sale-orders', { ...p, no, version: loaded?.version });
      setLoaded(d.order);
      push({ kind: 'success', title: 'บันทึกการแก้ไขใบสั่งขายแล้ว', desc: d.order.no });
    } catch (e) {
      if (!form.current?.fromApi(e, () => void reload()))
        push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  // ปฏิเสธ / ส่งกลับแก้ไข need a reason (the server refuses without one), ยกเลิก asks one too — in this dialog
  const [asking, setAsking] = React.useState<'deny' | 'reject' | 'cancel' | null>(null);
  const [reason, setReason] = React.useState('');
  const LABEL = { approve: 'อนุมัติ', deny: 'ปฏิเสธ', reject: 'ส่งกลับแก้ไข', cancel: 'ยกเลิก' } as const;

  // ยกเลิกใบสั่งขาย = soft delete through the records API (it re-checks who may, and refuses an approved one)
  const cancelOrder = async () => {
    setSaving(true);
    try {
      await postJson('/api/admin/records', { table: 'sale_orders', id, status: 'DELETED', remark: reason });
      void mutate('/api/alerts/sale-orders-pending'); // a waiting one leaves the bell
      setAsking(null);
      setReason('');
      push({ kind: 'success', title: 'ยกเลิกใบสั่งขายแล้ว', desc: no });
    } catch (e) {
      push({ kind: 'error', title: 'ยกเลิกไม่สำเร็จ', desc: errMsg(e) });
      if (!(e instanceof ApiError && e.status === 409)) return;
      setAsking(null);
    } finally {
      setSaving(false);
    }
    void reload(); // the order as it is now: cancelled, or (409) approved meanwhile
  };

  // an approved order without a slip: the customer paid later — the slip (and amount) is added once
  const [paidLater, setPaidLater] = React.useState('');
  const attachSlip = async (f: File | undefined) => {
    if (!f || !id) return;
    let ok = true;
    try {
      await upload('/api/upload', { kind: 'sale-order-slip', id, paymentAmount: paidLater }, f);
      push({ kind: 'success', title: 'แนบสลิปการชำระเงินแล้ว', desc: f.name });
      setPaidLater('');
    } catch (e) {
      push({ kind: 'error', title: 'แนบสลิปไม่สำเร็จ', desc: errMsg(e) });
      ok = false;
    }
    void reload();
    return ok;
  };

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
      // the version on screen: the creator saved since (other lines / qty) → 409, nothing is issued
      const d = await postJson<{ order: SaleOrderLoaded }>(`/api/sale-orders/${id}/approve`, {
        decision,
        remark,
        version: loaded?.version,
      });
      setLoaded(d.order);
      void mutate('/api/alerts/sale-orders-pending'); // the bell drops it now, not at the next poll
      setAsking(null);
      setReason('');
      push({ kind: 'success', title: `${label}แล้ว`, desc: `${d.order.no} · ${d.order.approve}` });
    } catch (e) {
      push({ kind: 'error', title: `${label}ไม่สำเร็จ`, desc: errMsg(e) });
      // decided in another tab / changed by the creator: show the order as it is now (its buttons too)
      if (e instanceof ApiError && e.status === 409) {
        setAsking(null);
        void reload();
      }
    } finally {
      setSaving(false);
    }
  };

  // เลขพัสดุ — only on an approved order (POST /api/sale-orders/:id/tracking; the server checks the format)
  const [tracking, setTracking] = React.useState('');
  const [trackingOf, setTrackingOf] = React.useState<SaleOrderLoaded | null>(null);
  const te = useFormErrors();
  if (loaded !== trackingOf) {
    setTrackingOf(loaded);
    setTracking(loaded?.tracking ?? '');
  }
  // a บทสอน that typed a reason (the cancel dialog it opens) or a parcel no. leaves both as they were
  useTourRestore(
    () => ({ reason, tracking }),
    (v) => {
      setReason(v.reason);
      setTracking(v.tracking);
    },
  );
  const saveTracking = async () => {
    if (te.report(te.run(trackingSchema(loaded?.tracking), { tracking }))) return;
    setSaving(true);
    try {
      // the version on screen: another user saved a number since → 409, and the reload shows theirs
      const d = await postJson<{ order: SaleOrderLoaded }>(`/api/sale-orders/${id}/tracking`, {
        tracking,
        version: loaded?.version,
      });
      setLoaded(d.order);
      push({ kind: 'success', title: 'บันทึกเลขพัสดุแล้ว', desc: d.order.tracking || no });
    } catch (e) {
      if (!te.fromApi(e)) push({ kind: 'error', title: 'บันทึกเลขพัสดุไม่สำเร็จ', desc: errMsg(e) });
      if (e instanceof ApiError && e.status === 409) void reload();
    } finally {
      setSaving(false);
    }
  };

  // 4 อนุมัติแล้ว / 5 ปฏิเสธ are final — the server refuses any change, so no save or decision buttons
  const approveId = loaded?.approveId ?? 0;
  const closed = [4, 5].includes(approveId);
  // only a waiting order is decided, only by a role with SO Approve, and not by its creator (System Admin may)
  // — the server checks the same
  const isCreator = !isAdmin && !!userId && (loaded?.creatorIds ?? []).includes(userId);
  const selfReason = !isCreator ? '' : userId === loaded?.createdById ? SELF_APPROVE : SELF_APPROVE_SALES;
  const canApprove = has('SO Approve') && can('Sale Order', 'edit') && !isCreator;
  const decided = approveId === 3 || approveId === 5;
  // a waiting order is edited only by its creator (System Admin may) — the server refuses anyone else
  const waitingLocked = approveId === 2 && !isAdmin && userId !== loaded?.createdById;
  const canEditTracking = isAdmin || can('Sale Order', 'edit');
  // who may cancel — the records API's rule: Sale Order delete, and System Admin / SO Approve, or the creator;
  // never a closed (approved = stock issued, or denied) or cancelled one
  const canCancel =
    !!loaded &&
    !loaded.cancelled &&
    !closed &&
    can('Sale Order', 'edit') &&
    (isAdmin || has('SO Approve') || userId === loaded.createdById);

  return (
    <>
      <PageHeader title="แก้ไขใบสั่งขาย" description="เมนูขาย » ใบสั่งขาย" />
      <JobLookupBar
        id="so-no"
        label="ระบุ เลขใบสั่งขาย (SO)"
        placeholder="SO2600760"
        initial={no}
        onFind={(v) => void lookUp(v)}
      />
      <RecordGate ready={!!loaded} loading={loading} error={error} noun="ใบสั่งขาย" searchId="so-no">
        {loaded && (
          <div className="surface flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">สถานะ</span>
              <Badge
                tone={loaded.cancelled ? 'neutral' : (SO_TONE[loaded.approve] ?? 'neutral')}
                dot
                className="px-3 py-1 text-sm"
              >
                {loaded.cancelled ? 'ยกเลิก' : loaded.approve}
              </Badge>
              {approveId === 2 && !canApprove && !loaded.cancelled && (
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
                  {loaded.approveRemark && ` · หมายเหตุ: ${loaded.approveRemark}`}
                </span>
              )}
            </div>
            {loaded.cancelled && (
              <p role="note" className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                {SO_CANCELLED} — แก้ไข อนุมัติ หรือพิมพ์ไม่ได้
                {loaded.cancelRemark && ` · เหตุผล: ${loaded.cancelRemark}`}
              </p>
            )}
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
                <CodeInput
                  maxLength={50}
                  value={tracking}
                  onChange={(e) => {
                    setTracking(e.target.value);
                    te.clear('tracking');
                  }}
                  disabled={!canEditTracking}
                  className="num"
                  accepts={trackingAccepts}
                  onFix={(v) => {
                    setTracking(v);
                    te.clear('tracking');
                  }}
                />
              </Field>
              {canEditTracking && (
                <Button
                  size="md"
                  type="button"
                  onClick={saveTracking}
                  disabled={saving || tracking.trim() === (loaded?.tracking ?? '')}
                  data-tour-block // saves: a บทสอน lets the box be tried, never this
                >
                  บันทึกเลขพัสดุ
                </Button>
              )}
              {loaded?.deliveryDate && (
                <span className="text-sm text-muted-foreground sm:pb-2">วันที่บันทึกจัดส่ง {loaded.deliveryDate}</span>
              )}
            </div>
          </Section>
        )}
        {approveId === 4 && !loaded?.cancelled && !loaded?.slip && can('Sale Order', 'edit') && (
          <Section
            title="แนบสลิปการชำระเงิน"
            icon={Wallet}
            description="ใบนี้อนุมัติแล้วแต่ยังไม่มีสลิป — แนบได้ครั้งเดียว"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field
                label="จำนวนเงินที่ชำระ (บาท)"
                className="sm:max-w-xs"
                hint={`ยอดรวม ${baht(loaded?.amount ?? 0)} — เว้นว่างได้`}
              >
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  max={loaded?.amount}
                  inputMode="decimal"
                  value={paidLater}
                  onChange={(e) => setPaidLater(e.target.value)}
                  className="num text-right"
                />
              </Field>
              <Field
                label="สลิปการชำระเงิน"
                className="flex-1"
                hint="อัปโหลดแล้วบันทึกเข้าระบบทันที พร้อมจำนวนเงินที่กรอก"
              >
                <FileInput
                  placeholder="แนบสลิปการชำระเงิน (JPG, PNG, WEBP, PDF)"
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  onFile={attachSlip}
                />
              </Field>
            </div>
          </Section>
        )}
        <FormActions
          cancelLabel="กลับ"
          saveLabel="บันทึกการแก้ไข"
          onSave={save}
          saving={saving}
          cancelHref="/sale/orders"
          denied={
            loaded?.cancelled
              ? `${SO_CANCELLED} — แก้ไขไม่ได้`
              : closed
                ? `ใบสั่งขาย${loaded?.approve ?? ''} — แก้ไขไม่ได้`
                : !can('Sale Order', 'edit')
                  ? VIEW_ONLY
                  : waitingLocked
                    ? WAITING_CREATOR_ONLY
                    : undefined
          }
          extra={
            <>
              {/* a denied order is not printed (the print page refuses it too) */}
              {approveId !== 5 && (
                <PrintButton
                  label="พิมพ์ใบสั่งขาย"
                  kind="sale_order"
                  locked={
                    profileLock('sale_order', { statusId: loaded?.approveId, cancelled: loaded?.cancelled }) ||
                    (waitingLocked ? WAITING_CREATOR_ONLY : '')
                  }
                  no={no ?? ''}
                  profileId={loaded?.documentProfileId}
                  href={`/print/sale-order/${id}`}
                  disabled={!no || loaded?.cancelled}
                />
              )}
              {canCancel && (
                <Button variant="outline" size="md" type="button" onClick={() => setAsking('cancel')} disabled={saving}>
                  ยกเลิกใบสั่งขาย
                </Button>
              )}
              {loaded && approveId === 2 && canApprove && !loaded.cancelled ? (
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
          asking === 'cancel'
            ? 'ใบนี้จะถูกยกเลิก ไม่ตัดสต๊อก แก้ไข อนุมัติ หรือพิมพ์ไม่ได้อีก — ยังค้นดูได้ที่รายการใบสั่งขาย "แสดงใบที่ยกเลิก"'
            : asking === 'deny'
              ? 'ใบนี้จะถูกปฏิเสธ ไม่ตัดสต๊อก และอนุมัติภายหลังไม่ได้'
              : 'ใบจะถูกส่งกลับให้ผู้สร้างแก้ไข แล้วส่งขออนุมัติใหม่'
        }
        size="sm"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setAsking(null)}>
              {asking === 'cancel' ? 'ไม่ยกเลิก' : 'ยกเลิก'}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={saving || !reason.trim()}
              onClick={() => (asking === 'cancel' ? cancelOrder() : asking && decide(asking, reason))}
            >
              {asking === 'cancel' ? 'ยกเลิกใบสั่งขาย' : asking ? LABEL[asking] : ''}
            </Button>
          </>
        }
      >
        <Field label="เหตุผล" required hint={`${reason.length}/100 ตัวอักษร — ทุกคนที่เปิดใบนี้จะเห็นเหตุผลนี้`}>
          <Textarea rows={3} maxLength={100} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Modal>
    </>
  );
}

export default function EditSaleOrderPage() {
  return (
    <React.Suspense fallback={null}>
      <RecordKey of={(sp) => sp.get('id') ?? ''}>
        <EditSaleOrder />
      </RecordKey>
    </React.Suspense>
  );
}
