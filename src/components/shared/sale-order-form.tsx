'use client';

import * as React from 'react';
import { UserRound, FileText, Wallet } from 'lucide-react';
import { Section } from './section';
import { CustomerSelect } from './customer-select';
import { ProfileSelect } from './profile-select';
import { Field, FieldGrid, ReadOnly } from '@/components/ui/field';
import { FileInput, Input, Textarea, Radio } from '@/components/ui/input';
import { SearchSelect } from '@/components/shared/search-select';
import { useToast } from '@/components/ui/toast';
import { PAYMENT_METHODS } from '@/data/options';
import type { Customer } from '@/data/types';
import { useStaff } from '@/data/db';
import { baht } from '@/lib/utils';
import { errMsg, uploadFile, fileUrl } from '@/lib/api';
import { useAccess } from '@/lib/use-access';
import { useFormErrors } from '@/lib/use-form-errors';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import {
  overpaidMessage,
  saleOrderSchema,
  SUBMIT_CREATOR_ONLY,
  WAITING_CREATOR_ONLY,
} from '@/lib/validation/sale-order';
import { useMountTime } from '@/lib/use-client';
import { isoDateTime } from '@/lib/dates';
import { SaleOrderLines, type SaleOrderLine as Line } from '@/components/sale/sale-order-lines';
import { useTourRestore } from '@/components/tour/tour';
import { profileLock } from '@/lib/profile-lock';

// approve status label (approve_name_th; 3 is shown as ส่งกลับแก้ไข) → badge tone (list + edit page)
export const SO_TONE: Record<string, 'warning' | 'success' | 'danger' | 'info'> = {
  รออนุมัติ: 'warning',
  อนุมัติแล้ว: 'success',
  ปฏิเสธ: 'danger',
  ส่งกลับแก้ไข: 'danger',
  กำลังดำเนินการจัดทำ: 'info',
};

/** GET /api/sale-orders/:no (subset the form uses) */
export type SaleOrderLoaded = {
  no: string;
  date: string;
  sales: string;
  /** sale_out_by — the salesperson is picked by id (a name can change; one who left is not in the list) */
  salesId?: number;
  /** record_status DELETED — the server refuses any change */
  cancelled?: boolean;
  createdBy: string;
  createdById?: number;
  /** a waiting order: the roles that may approve it */
  approverRoles?: string[];
  approve: string;
  approveId?: number;
  approveRemark?: string;
  approvedBy?: string;
  approveDate?: string;
  tracking?: string;
  /** stamped when the tracking no. is saved */
  deliveryDate?: string;
  /** who may not decide on it (the server refuses them; System Admin may) */
  creatorIds?: number[];
  paymentType?: string;
  paymentAmount?: number;
  /** net amount (lines + fee) */
  amount?: number;
  fee?: number;
  remark?: string;
  slip: string;
  documentProfileId?: number; // ออกเอกสารในนาม
  version?: number; // row_version — the edit page sends it back with its save
  customerDetail: {
    code: string;
    taxId: string;
    name: string;
    address: string;
    phone: string;
    line: string;
    email: string;
    /** the customer's status now — an Inactive one gets the picker's notice */
    status?: string;
  };
  /** why it was cancelled */
  cancelRemark?: string;
  lines: { code: string; name: string; type: 'SparePart' | 'Service'; qty: number; price: number }[];
};

export type SaleOrderPayload = {
  no?: string;
  documentProfileId?: number;
  customerCode: string;
  salesId?: number;
  lines: { code: string; qty: number; price: number; name: string; type: 'SparePart' | 'Service' }[];
  paymentType: string;
  paymentAmount: string;
  slip: string;
  remark: string;
  submit: boolean;
};

export type SaleOrderFormHandle = {
  payload: () => SaleOrderPayload;
  /** check before saving (lib/validation/sale-order) — shows the errors; true = OK */
  validate: () => boolean;
  /** API field errors → under the fields; false for any other error */
  fromApi: (err: unknown, reload?: () => void) => boolean;
  /** upload a slip chosen before the SO existed (new page calls this after create) */
  uploadPendingSlip: (soNo: string) => Promise<void>;
};

export const SaleOrderForm = React.forwardRef<SaleOrderFormHandle, { soNo?: string; initial?: SaleOrderLoaded | null }>(
  function SaleOrderForm({ soNo, initial }, ref) {
    const { push } = useToast();
    const { name: me, userId, isAdmin, can } = useAccess();
    const fe = useFormErrors();
    const { data: STAFF, ...staffLookup } = useStaff();
    // an existing SO fills the form when it mounts — the edit page remounts the form (key) for every
    // order it loads or saves, so this is the one place the form takes `initial`
    const [lines, setLines] = React.useState<Line[]>(() =>
      (initial?.lines ?? []).map((l, i) => ({
        id: i + 1,
        code: l.code,
        name: l.name,
        qty: l.qty,
        price: l.price,
        type: l.type,
      })),
    );
    const [profileId, setProfileId] = React.useState(initial?.documentProfileId ?? 0); // ออกเอกสารในนาม
    const [customer, setCustomer] = React.useState<Customer | null>(() => {
      const c = initial?.customerDetail;
      return c
        ? {
            code: c.code,
            name: c.name,
            address: c.address,
            phone: c.phone,
            email: c.email,
            line: c.line,
            taxId: c.taxId,
            status: (c.status ?? 'Active') as Customer['status'],
          }
        : null;
    });
    // พนักงานขาย: the one picked here, else the order's own salesperson, else (a new order) the
    // signed-in user — derived, so it is right whichever of the order / the staff list arrives first
    const [pickedSalesId, setSalesId] = React.useState<number>(0);
    const salesId =
      pickedSalesId ||
      (initial
        ? initial.salesId || (STAFF.find((x) => x.name === initial.sales)?.id ?? 0)
        : userId && STAFF.some((x) => x.id === userId && x.sells)
          ? userId
          : 0);
    // who sells (Sale Order add, or System Admin) — plus the order's own salesperson; the server allows the same.
    // The order's salesperson who has left is not in the staff list — still shown (and kept) as picked
    const salesOptions = STAFF.filter((u) => u.sells || u.id === initial?.salesId).map((u) => ({
      value: String(u.id),
      label: u.name,
      sub: u.userType || undefined,
    }));
    if (initial?.salesId && !STAFF.some((x) => x.id === initial.salesId))
      salesOptions.push({
        value: String(initial.salesId),
        label: `${initial.sales || '—'} (ไม่ใช้งานแล้ว)`,
        sub: undefined,
      });
    // no default: an order records a payment only when the user enters one
    const [payment, setPayment] = React.useState(initial?.paymentType ?? '');
    // a saved order's 0 shows as 0 — the API sends 0 for "no amount" too, so an order with neither type nor
    // amount stays empty (a save then keeps it null)
    const [payAmount, setPayAmount] = React.useState(
      initial && (initial.paymentAmount || initial.paymentType) ? String(initial.paymentAmount ?? 0) : '',
    );
    const [remark, setRemark] = React.useState(initial?.remark ?? '');
    const [slip, setSlip] = React.useState(initial?.slip ?? '');
    const [pendingSlip, setPendingSlip] = React.useState<File | null>(null);
    // the radio shows the order's real state: only a waiting (2) order is "sent"; a sent-back (3) one starts unsent
    const [submit, setSubmit] = React.useState(initial?.approveId === 2);
    // a บทสอน that tried the form leaves it as it found it (a slip file cannot be picked during one — not kept)
    useTourRestore(
      () => ({ lines, profileId, customer, pickedSalesId, payment, payAmount, remark, slip, submit }),
      (v) => {
        setLines(v.lines);
        setProfileId(v.profileId);
        setCustomer(v.customer);
        setSalesId(v.pickedSalesId);
        setPayment(v.payment);
        setPayAmount(v.payAmount);
        setRemark(v.remark);
        setSlip(v.slip);
        setSubmit(v.submit);
        fe.setErrors({});
      },
    );
    // only the creator (or System Admin) sends it for approval — anyone else's save keeps the status (server rule)
    const canSubmit = !initial || isAdmin || initial.createdById === userId;
    // read-only, as the server refuses the save: 4 อนุมัติแล้ว / 5 ปฏิเสธ are final, a cancelled order is
    // closed, and a waiting (2) order is edited only by its creator (System Admin may)
    // … and an account that may only look (no Sale Order edit): shown the same way, read-only text, not live inputs
    const viewOnly = !!initial && !can('Sale Order', 'edit');
    const readOnly =
      [4, 5].includes(initial?.approveId ?? 0) ||
      !!initial?.cancelled ||
      (initial?.approveId === 2 && !canSubmit) ||
      viewOnly;
    // the edit page's "แนบสลิปการชำระเงิน" (an approved order without a slip) — the same rule as there
    const canAttachLater = initial?.approveId === 4 && !initial.cancelled && !initial.slip && can('Sale Order', 'edit');

    // สลิป → bucket oneservice/sale-orders/{no}/slip/… (path เก็บใน sale_out_hd.slip_file_name)
    const onPickSlip = async (f: File | undefined) => {
      if (!f) return;
      const no = soNo || initial?.no;
      if (!no) {
        setPendingSlip(f);
        setSlip(f.name);
        return;
      }
      try {
        const d = await uploadFile('sale-order-slip', no, f);
        setSlip(d.path);
        setSaved((x) => ({ ...x, slip: d.path })); // saved to the order right away — not an edit
        push({ kind: 'success', title: 'อัปโหลดสลิปแล้ว', desc: f.name });
      } catch (e) {
        push({ kind: 'error', title: 'อัปโหลดสลิปไม่สำเร็จ', desc: errMsg(e) });
        return false; // the file input lets go of the name
      }
    };
    // the order's own date, or (a new order) when the screen opened — Thai time, browser only
    const openedAt = useMountTime();
    const date = initial?.date ?? (openedAt ? isoDateTime(openedAt) : '');

    // the form as it opened (a loaded order, or empty) — anything else is an unsaved edit
    const now = {
      profileId,
      customer: customer?.code ?? '',
      pickedSalesId,
      lines,
      payment,
      payAmount,
      remark,
      slip,
      submit,
    };
    const [saved, setSaved] = React.useState(now);
    useUnsavedChanges(JSON.stringify(now) !== JSON.stringify(saved));

    const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
    const net = total + (initial?.fee ?? 0); // the edit keeps the order's fee
    // the server refuses more than the total — shown as soon as a line change makes it so
    const overpaid = payAmount !== '' && Number(payAmount) > Math.round(net * 100) / 100;

    // a value that changes takes its error away
    const { clear } = fe;
    React.useEffect(() => clear('customerCode'), [customer, clear]);
    React.useEffect(() => clear('salesId'), [salesId, clear]);
    React.useEffect(() => clear('lines'), [lines.length, clear]);
    React.useEffect(() => clear('paymentAmount'), [payAmount, clear]);
    React.useEffect(() => clear('paymentType'), [payment, clear]);

    const payloadOf = (): SaleOrderPayload => ({
      no: soNo || initial?.no || undefined,
      documentProfileId: profileId || undefined,
      customerCode: customer?.code ?? '',
      salesId: salesId || undefined,
      lines: lines.map((l) => ({ code: l.code, qty: l.qty, price: l.price, name: l.name, type: l.type })),
      paymentType: payment,
      paymentAmount: payAmount,
      slip: slip.includes('/') ? slip : '',
      remark,
      submit,
    });
    React.useImperativeHandle(ref, () => ({
      uploadPendingSlip: async (no: string) => {
        if (!pendingSlip) return;
        try {
          await uploadFile('sale-order-slip', no, pendingSlip);
          setPendingSlip(null);
        } catch (e) {
          push({ kind: 'error', title: 'อัปโหลดสลิปไม่สำเร็จ', desc: errMsg(e) });
        }
      },
      // an edit keeps a legacy payment type ("ยังไม่ชำระเงิน") it already has
      validate: () =>
        !fe.report(
          fe.run(saleOrderSchema(initial ? { paymentType: initial.paymentType, fee: initial.fee } : null), payloadOf()),
        ),
      fromApi: fe.fromApi,
      payload: () => payloadOf(),
    }));

    return (
      <fieldset disabled={readOnly} className="contents">
        <Section
          title="ข้อมูลลูกค้า"
          icon={UserRound}
          description={
            customer ? 'ข้อมูลกลางจากตารางลูกค้า (อ่านอย่างเดียว)' : 'เลือก ลูกค้าเดิม เพื่อค้นหา หรือ ลูกค้าใหม่'
          }
        >
          <Field error={fe.errors.customerCode}>
            <CustomerSelect value={customer} onChange={setCustomer} />
          </Field>
        </Section>

        <Section title="ข้อมูลใบสั่งขาย" icon={FileText}>
          <FieldGrid>
            <Field label="เลขใบสั่งขาย">
              <ReadOnly>
                <span className="num">{soNo ?? initial?.no ?? 'ออกเลขอัตโนมัติเมื่อบันทึก'}</span>
              </ReadOnly>
            </Field>
            <ProfileSelect
              value={profileId}
              onChange={(id, how) => {
                setProfileId(id);
                if (how !== 'user') setSaved((x) => ({ ...x, profileId: id })); // a default / saved on the spot — not an edit
              }}
              doc={soNo || initial?.no ? { kind: 'sale_order', no: soNo || initial?.no || '' } : undefined}
              // the fieldset disables it on a read-only order — the hint says why
              locked={
                profileLock('sale_order', { statusId: initial?.approveId, cancelled: initial?.cancelled }) ||
                (readOnly && !viewOnly ? WAITING_CREATOR_ONLY : '')
              }
            />
            <Field label="วันที่สร้าง">
              <ReadOnly>
                <span className="num">{date}</span>
              </ReadOnly>
            </Field>
            <Field label="สร้างโดย">
              <ReadOnly>{initial?.createdBy || me || '—'}</ReadOnly>
            </Field>
            <Field label="พนักงานขาย" required error={fe.errors.salesId} lookup={staffLookup}>
              <SearchSelect
                value={salesId ? String(salesId) : ''}
                onChange={(v) => setSalesId(Number(v) || 0)}
                options={salesOptions}
                placeholder="- - ยังไม่ระบุ - -"
                emptyLabel="- - ยังไม่ระบุ - -"
                searchPlaceholder="พิมพ์ชื่อพนักงานขาย…"
              />
            </Field>
          </FieldGrid>
        </Section>

        <SaleOrderLines
          lines={lines}
          setLines={setLines}
          total={total}
          readOnly={readOnly}
          errors={fe.errors}
          clear={fe.clear}
          showZero={!!initial}
          stockNote={initial?.approveId === 2 && !initial.cancelled}
        />

        <Section title="การชำระเงินและเอกสาร" icon={Wallet}>
          <FieldGrid>
            {readOnly ? (
              // a closed order: the method it was paid by, not a row of greyed-out choices
              <Field label="วิธีการชำระเงิน" className="lg:col-span-2">
                <ReadOnly>{payment || 'ยังไม่ระบุ'}</ReadOnly>
              </Field>
            ) : (
              <Field label="วิธีการชำระเงิน" className="lg:col-span-2" group="radiogroup" error={fe.errors.paymentType}>
                <div className="flex flex-wrap gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
                  {PAYMENT_METHODS.map((p) => (
                    <label key={p} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Radio name="payment" checked={payment === p} onChange={() => setPayment(p)} />
                      {p}
                    </label>
                  ))}
                </div>
              </Field>
            )}
            {readOnly ? (
              // read-only as text, like the method above — not a greyed-out box and file picker
              <>
                <Field label="จำนวนเงินที่ชำระ (บาท)">
                  <ReadOnly>
                    {payAmount !== '' && Number(payAmount) > 0 ? (
                      <>
                        ชำระแล้ว <span className="num">{baht(Number(payAmount))}</span> บาท
                      </>
                    ) : (
                      'ยังไม่ชำระ'
                    )}
                  </ReadOnly>
                </Field>
                <Field label="สลิปการชำระเงิน">
                  <ReadOnly>
                    {slip.includes('/') ? (
                      <a href={fileUrl(slip)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        ดูสลิป
                      </a>
                    ) : slip ? (
                      `สลิปอยู่บนระบบเก่า: ${slip}`
                    ) : canAttachLater ? (
                      'ยังไม่มีสลิป — แนบได้ที่ส่วน "แนบสลิปการชำระเงิน" ด้านล่าง'
                    ) : (
                      'ยังไม่มีสลิป'
                    )}
                  </ReadOnly>
                </Field>
              </>
            ) : (
              <>
                <Field
                  label="จำนวนเงินที่ชำระ (บาท)"
                  error={fe.errors.paymentAmount || (overpaid ? overpaidMessage(net) : undefined)}
                  hint={`ยอดรวม ${baht(net)} — ใส่เฉพาะยอดที่ลูกค้าชำระแล้ว`}
                >
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    max={10_000_000}
                    inputMode="decimal"
                    placeholder="ยังไม่ชำระ"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    className="num text-right"
                  />
                </Field>
                <Field
                  label="สลิปการชำระเงิน"
                  hint={
                    pendingSlip
                      ? `จะอัปโหลดหลังบันทึก: ${slip}`
                      : initial
                        ? `อัปโหลดแล้วบันทึกเข้าระบบทันที${slip ? ' (แทนที่สลิปเดิม)' : ''}` +
                          (slip && !slip.includes('/') ? ` · สลิปเดิมอยู่บนระบบเก่า: ${slip}` : '') // a legacy row: a bare file name, the file is not here
                        : undefined
                  }
                >
                  <div className="flex items-center gap-2">
                    <FileInput
                      placeholder="เลือกไฟล์สลิป (JPG, PNG, PDF)"
                      accept=".jpg,.jpeg,.png,.webp,.pdf"
                      onFile={onPickSlip}
                    />
                    {slip.includes('/') && (
                      <a
                        href={fileUrl(slip)}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-xs text-primary hover:underline"
                      >
                        ดูสลิป
                      </a>
                    )}
                  </div>
                </Field>
              </>
            )}
            <Field label="หมายเหตุ" wide error={fe.errors.remark} hint={`${remark.length}/100 ตัวอักษร`}>
              <Textarea rows={2} maxLength={100} value={remark} onChange={(e) => setRemark(e.target.value)} />
            </Field>
            {!readOnly && (
              <Field
                label="บันทึกเป็น"
                required
                wide
                group="radiogroup"
                hint={
                  !canSubmit
                    ? `${SUBMIT_CREATOR_ONLY} — บันทึกแล้วสถานะคงเดิม`
                    : initial?.approveId === 3
                      ? 'ใบนี้ถูกส่งกลับแก้ไข — แก้แล้วเลือก "ส่งขออนุมัติ" เพื่อส่งให้อนุมัติอีกครั้ง'
                      : undefined
                }
              >
                <div className="flex flex-wrap gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
                  {[
                    { k: false, l: 'กำลังจัดทำ (ยังไม่ส่งอนุมัติ)' },
                    { k: true, l: 'ส่งขออนุมัติ' },
                  ].map((a) => (
                    <label key={a.l} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Radio
                        name="so-action"
                        checked={submit === a.k}
                        onChange={() => setSubmit(a.k)}
                        disabled={!canSubmit}
                      />
                      {a.l}
                    </label>
                  ))}
                </div>
              </Field>
            )}
          </FieldGrid>
        </Section>
      </fieldset>
    );
  },
);
