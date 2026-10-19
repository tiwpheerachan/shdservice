'use client';

import * as React from 'react';
import { PackageCheck, ClipboardList, Wallet } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { JobSearch } from '@/components/shared/job-search';
import { Section } from '@/components/shared/section';
import {
  CustomerSection,
  ProductSection,
  FormActions,
  VIEW_ONLY,
  JobScreen,
  useJobForm,
  fromJob,
  saveCommonSections,
  useWorkflowErrors,
  useMoneyLock,
} from '@/components/shared/job-form';
import { useConfirm } from '@/components/ui/confirm';
import { useAccess } from '@/lib/use-access';
import { Tabs } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Field, FieldGrid, ReadOnly } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { RETURN_METHODS, JOB_PAYMENT_METHODS, CLOSE_STATUS_OPTIONS } from '@/data/mock';
import { useShippers, useShippingProfiles } from '@/data/db';
import { baht } from '@/lib/utils';
import { RecordGate } from '@/components/shared/record-gate';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useJob, type JobDetail } from '@/lib/use-job';
import { SEND_STATUS } from '@/lib/outsource-status';
import { PrintButton } from '@/components/shared/print-button';
import { postJson, errMsg, uploadFile, fileUrl } from '@/lib/api';
import { today as thaiToday } from '@/lib/dates';
import {
  closePaymentEdited,
  closeSchema,
  jobBalance,
  noteMaxLength,
  partsWaitingMsg,
  paymentDetailOf,
  returnDetailOf,
  refundDateOf,
  OUTSOURCE_NOT_BACK,
  STATUS_CLOSED_TRACKED,
  STATUS_CLOSED_WAIT_TRACKING,
} from '@/lib/validation/job';

/** the date saved inside job_payment_detail ("ชำระ <date> · …") */
const payDateOf = (detail: string) => /^ชำระ (\d{4}-\d{2}-\d{2})/.exec(detail)?.[1] ?? '';

function CloseForm() {
  const { push } = useToast();
  const { data: SHIPPERS } = useShippers();
  const { data: SHIPPING } = useShippingProfiles();
  // every job that arrives — from the URL, the search bar, or a save (setJob) — fills the form
  const { jobNo, job, loading, error, find, setJob } = useJob({ onRecord: (j) => prefill(j) });
  const { s: form, reset, adopt } = useJobForm();
  const act = useWorkflowErrors(() => find(jobNo)); // stale save → read the same job again
  const { can } = useAccess();
  const confirm = useConfirm();
  const lock = useMoneyLock(); // a closed job: the payment stays as recorded (Job Money After Close may change it)
  const [tab, setTab] = React.useState('product');
  const [saving, setSaving] = React.useState(false);
  const [d, setD] = React.useState({
    payType: '',
    payAmount: '',
    payDate: '',
    payNo: '',
    payDetail: '',
    refType: '',
    refAmount: '',
    refDate: '',
    returnType: '',
    returnDate: '',
    courier: '',
    shipperId: 0,
    tracking: '',
    returnDetail: '',
    status: '',
  });
  // editing a field clears its error (keys = the payload paths the rules report)
  const ERR_KEY: Partial<Record<keyof typeof d, string>> = {
    status: 'status',
    payType: 'payment.type',
    payAmount: 'payment.amount',
    payDate: 'payment.date',
    payNo: 'payment.no',
    payDetail: 'payment.detail',
    refType: 'refund.type',
    refAmount: 'refund.amount',
    refDate: 'refund.date',
    returnType: 'return.type',
    courier: 'return.detail',
    returnDetail: 'return.detail',
    returnDate: 'return.date',
    tracking: 'return.tracking',
  };
  const upd = (p: Partial<typeof d>) => {
    setD((x) => ({ ...x, ...p }));
    (Object.keys(p) as (keyof typeof d)[]).forEach((k) => ERR_KEY[k] && act.clear(ERR_KEY[k]));
  };
  const [slip, setSlip] = React.useState('');
  // what prefill last put on screen (the job as loaded / saved) — anything else is an unsaved edit
  // (the slip is not: an upload is saved to the job right away)
  const [saved, setSaved] = React.useState<typeof d | null>(null);
  useUnsavedChanges(!!saved && JSON.stringify(d) !== JSON.stringify(saved));
  // สลิปชำระเงิน → bucket oneservice/jobs/{no}/slip/… (path เก็บใน job.job_payment_slip_file_name)
  const onPickSlip = async (f: File | undefined) => {
    if (!f || !job) return;
    try {
      const r = await uploadFile('job-slip', job.no, f);
      setSlip(r.path);
      push({ kind: 'success', title: 'อัปโหลดสลิปแล้ว', desc: f.name });
    } catch (e) {
      push({ kind: 'error', title: 'อัปโหลดสลิปไม่สำเร็จ', desc: errMsg(e) });
    }
  };

  // cost summary straight from the job row
  const SUMMARY = [
    { label: 'รวมค่าอะไหล่', v: job?.partsCost ?? 0 },
    { label: 'ค่าบริการการซ่อม', v: job?.serviceCost ?? 0 },
    { label: 'ค่าเครื่องมือพิเศษ', v: job?.toolCost ?? 0 },
    { label: 'ค่าขนส่ง', v: job?.deliveryCost ?? 0 },
    { label: 'ค่ากล่องพัสดุ', v: job?.boxCost ?? 0 },
  ];
  const net = SUMMARY.reduce((s, x) => s + x.v, 0);
  // still at the out-source vendor → the server refuses the close; say so before the user fills the form
  const outsourceOut = !!job?.outsource.some((o) => o.status === SEND_STATUS.SENT);
  // a part requested from stock (เบิก) not issued yet → the server refuses a close of an open job (setStatus)
  const waiting = job?.parts.filter((p) => p.statusId === 1 && p.isSpecial && p.requested > p.granted) ?? [];
  const partsWait =
    waiting.length && job?.statusGroup !== 'Finished' && d.status ? partsWaitingMsg(waiting, d.status) : undefined;
  const deposit = job?.depositCost ?? 0;
  // the payment is sent only when the user edited it (never on a locked job) — otherwise the stored one stays
  const paid = closePaymentEdited(d, saved, !!lock);
  // paying less than due is allowed but never silent: shown here and confirmed at save
  const bal = jobBalance(net, deposit, paid ? Number(d.payAmount || 0) : (job?.payment.amount ?? 0));
  // money already given back (a swap/refund job stores it as a negative payment): shown as it is, no payment inputs
  // — the hidden fields stay as loaded, so a save sends no payment and the refund is kept
  const gaveBack = job && job.payment.amount < 0 ? job.payment : null;
  const refunded = gaveBack && bal.refund === 0 ? gaveBack : null;
  // how it went back: "เงินสด, 2026-10-01" (the date is in the detail: "คืนมัดจำ <date>")
  const gaveBackHow = gaveBack
    ? [gaveBack.type, gaveBack.no, refundDateOf(gaveBack.detail)].filter(Boolean).join(', ')
    : '';
  // the save puts the payment date / the courier in front of these notes (one varchar(100) each)
  const payDetailMax = noteMaxLength((n) => paymentDetailOf(d.payDate, n), d.payDetail);
  const returnDetailMax = noteMaxLength((n) => returnDetailOf(d.courier, n), d.returnDetail);

  function prefill(job: JobDetail) {
    reset(fromJob(job));
    setSlip(job.payment.slip);
    const today = thaiToday(); // Thai calendar, not UTC
    const next = {
      // no default method / date: a payment is written only when someone enters one (in-warranty = none)
      payType: job.payment.type,
      // nothing paid yet → empty (an untouched box is no payment, so it must not show one): choosing the
      // method fills in what is left to pay (job.amountDue)
      payAmount: job.payment.amount > 0 ? String(job.payment.amount) : '',
      payDate: payDateOf(job.payment.detail), // kept as it is on a re-save
      payNo: job.payment.no,
      payDetail: job.payment.detail,
      // a deposit given back is stored as a negative payment ("คืนมัดจำ <date>"); none yet → the full refund, today
      refType: job.payment.amount < 0 ? job.payment.type : '',
      refAmount:
        job.payment.amount < 0 ? String(-job.payment.amount) : job.depositRefund > 0 ? String(job.depositRefund) : '',
      refDate: refundDateOf(job.payment.detail) || today,
      returnType: job.return.type,
      returnDate: job.return.date ? job.return.date.slice(0, 10) : today,
      // saved as "<courier> · <note>": its own head first ("ไปรษณีย์ไทย · …" is not the shorter "ไปรษณีย์")
      courier: job.return.detail.includes(' · ')
        ? (job.return.detail.split(' · ')[0] ?? '')
        : (SHIPPERS.find((c) => job.return.detail.includes(c)) ?? ''),
      shipperId: job.return.shipperId ?? 0,
      tracking: job.return.tracking,
      returnDetail: job.return.detail,
      status: CLOSE_STATUS_OPTIONS.includes(job.status) ? job.status : '',
    };
    upd(next);
    setSaved(next);
  }

  const go = (v: string) => find(v);

  // POST /api/jobs/:no/close → payment + return fields, job_closed_date/by, status + job_log
  const save = async () => {
    if (!job) return; // the save bar only shows once a job is loaded (RecordGate)
    const p = job.payment;
    // deposit more than the total: a refund instead of a payment — asked while none is recorded, sent when edited
    const refundOn = bal.refund > 0 && !lock;
    const refundNeeded = refundOn && p.amount === 0;
    const refundEdited = (['refType', 'refAmount', 'refDate'] as const).some((k) => d[k] !== saved?.[k]);
    const body = {
      // only what the user edited (closePaymentEdited): untouched = the stored payment / refund stays as it is
      payment:
        paid && bal.refund === 0
          ? { type: d.payType, amount: d.payAmount, date: d.payDate, no: d.payNo, detail: d.payDetail }
          : undefined,
      refund:
        refundNeeded || (refundOn && refundEdited)
          ? { type: d.refType, amount: d.refAmount, date: d.refDate }
          : undefined,
      return: {
        type: d.returnType,
        date: d.returnDate,
        courier: d.courier,
        tracking: d.tracking,
        detail: d.returnDetail,
        shipperId: d.shipperId || undefined,
      },
      status: d.status,
    };
    const canEdit = can('Job Management', 'edit');
    // the receipt / parcel no as loaded: an unchanged legacy value still passes
    const prev = {
      payNo: saved?.payNo,
      tracking: saved?.tracking,
      refund: { max: bal.refund, required: refundNeeded },
    };
    if (!act.check(closeSchema(prev), body, canEdit)) {
      if ((paid && !d.payType) || body.refund || refundNeeded) setTab('payment'); // asked on the payment tab
      return;
    }
    if (partsWait) return push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: partsWait });
    if (
      bal.outstanding > 0 &&
      (job.statusGroup !== 'Finished' || paid) &&
      !(await confirm({
        title: `ลูกค้าค้างชำระ ${baht(bal.outstanding)} บาท — ยืนยันปิดงาน?`,
        description: `ยอดที่ต้องชำระ ${baht(bal.due)} บาท · รับชำระ ${baht(bal.due - bal.outstanding)} บาท — ใบส่งคืนสินค้าจะพิมพ์บรรทัด "ค้างชำระ"`,
        confirmLabel: 'ยืนยันปิดงาน',
      }))
    )
      return;
    setSaving(true);
    try {
      adopt(await saveCommonSections(job.no, form, canEdit));
      const r = await postJson<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(job.no)}/close`, body);
      setJob(r.job);
      push({ kind: 'success', title: 'ปิดงานและบันทึกการส่งคืนเรียบร้อย', desc: `${r.job.no} · ${r.job.status}` });
    } catch (e) {
      if (!act.fromApi(e)) push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="ปิดงาน - ส่งคืนสินค้า"
        description="ข้อมูลงานบริการ » ปิดงาน-ส่งคืนสินค้า"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="close-job-no" className="whitespace-nowrap text-xs font-medium text-muted-foreground">
              ระบุ หมายเลขงาน
            </label>
            <JobSearch id="close-job-no" value={jobNo} scope="closable" onPick={go} />
            <PrintButton
              label="พิมพ์ใบส่งคืน"
              kind="job"
              no={job?.no ?? ''}
              profileId={job?.documentProfileId}
              href={`/print/job/${encodeURIComponent(job?.no ?? '')}/return`}
              disabled={!job}
            />
            <PrintButton
              label="พิมพ์ใบปะหน้าพัสดุ"
              title="ใบปะหน้าพัสดุ A5 สำหรับส่งคืนทางขนส่ง"
              kind="job"
              no={job?.no ?? ''}
              profileId={job?.documentProfileId}
              href={`/print/job/${encodeURIComponent(job?.no ?? '')}/label`}
              disabled={!job}
            />
          </div>
        }
      />

      <RecordGate ready={!!job} loading={loading} error={error} noun="งาน" searchId="close-job-no">
        <CustomerSection readOnly />

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

        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'product', label: 'ข้อมูลสินค้า' },
            { key: 'work', label: 'รายละเอียดการดำเนินงาน' },
            { key: 'payment', label: 'รายละเอียดการรับชำระเงิน' },
          ]}
        />

        {tab === 'product' && <ProductSection title="ข้อมูลสินค้า" />}

        {tab === 'work' && (
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
        )}

        {tab === 'payment' && (
          <Section title="รายละเอียดการรับชำระเงิน" icon={Wallet}>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <ul className="space-y-2 text-sm">
                  {SUMMARY.map((s) => (
                    <li key={s.label} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{s.label}</span>
                      <span className="num">{baht(s.v)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
                    <span>รวมเป็นเงินสุทธิ</span>
                    <span className="num text-primary">{baht(net)} ฿</span>
                  </li>
                  {deposit > 0 && (
                    <>
                      <li className="flex justify-between gap-3">
                        <span className="text-muted-foreground">หักเงินมัดจำ</span>
                        <span className="num">-{baht(deposit)}</span>
                      </li>
                      {bal.refund > 0 && gaveBack ? (
                        // already given back (a negative payment "คืนมัดจำ …") — not "to refund" any more
                        <li role="status" className="flex justify-between gap-3 text-base font-semibold">
                          <span>
                            คืนเงินมัดจำแล้ว
                            {gaveBackHow && (
                              <span className="block text-xs font-normal text-muted-foreground">({gaveBackHow})</span>
                            )}
                          </span>
                          <span className="num text-primary">{baht(-gaveBack.amount)} ฿</span>
                        </li>
                      ) : (
                        <li className="flex justify-between gap-3 text-base font-semibold">
                          {/* a deposit larger than the total (not repaired) goes back to the customer */}
                          <span>{bal.refund > 0 ? 'ต้องคืนเงินมัดจำ' : 'ยอดที่ต้องชำระ'}</span>
                          <span className="num text-primary">{baht(bal.refund || bal.due)} ฿</span>
                        </li>
                      )}
                    </>
                  )}
                  {bal.outstanding > 0 && (
                    <li role="status" className="flex justify-between gap-3 font-semibold text-warning">
                      <span>ลูกค้าค้างชำระ</span>
                      <span className="num">{baht(bal.outstanding)} ฿</span>
                    </li>
                  )}
                </ul>
              </div>
              {bal.refund > 0 ? (
                <FieldGrid cols={2}>
                  <Field label="วิธีการคืนเงินมัดจำ" required error={act.errors['refund.type']} hint={lock}>
                    <Select value={d.refType} disabled={!!lock} onChange={(e) => upd({ refType: e.target.value })}>
                      <option value="">- - เลือก - -</option>
                      {JOB_PAYMENT_METHODS.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                      {d.refType && !JOB_PAYMENT_METHODS.includes(d.refType) && <option>{d.refType}</option>}
                    </Select>
                  </Field>
                  <Field
                    label="จำนวนเงินที่คืน (บาท)"
                    required
                    error={act.errors['refund.amount']}
                    hint={`ไม่เกิน ${baht(bal.refund)} บาท`}
                  >
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      max={bal.refund}
                      inputMode="decimal"
                      value={d.refAmount}
                      disabled={!!lock}
                      onChange={(e) => upd({ refAmount: e.target.value })}
                      onFocus={(e) => e.currentTarget.select()}
                      className="num text-right"
                    />
                  </Field>
                  <Field label="วันที่คืนเงิน" required error={act.errors['refund.date']}>
                    <Input
                      type="date"
                      value={d.refDate}
                      disabled={!!lock}
                      onChange={(e) => upd({ refDate: e.target.value })}
                    />
                  </Field>
                </FieldGrid>
              ) : refunded ? (
                <p role="status" className="self-start rounded-lg border border-border p-4 text-sm font-medium">
                  คืนเงินแล้ว <span className="num">{baht(-refunded.amount)}</span> บาท
                  {gaveBackHow ? ` (${gaveBackHow})` : ''}
                </p>
              ) : (
                <FieldGrid cols={2}>
                  <Field label="วิธีการชำระเงิน" required={bal.due > 0} error={act.errors['payment.type']} hint={lock}>
                    <Select
                      value={d.payType}
                      disabled={!!lock}
                      onChange={(e) =>
                        upd({
                          payType: e.target.value,
                          payDate: d.payDate || thaiToday(),
                          payAmount: d.payAmount || (bal.due > 0 ? String(bal.due) : ''),
                        })
                      }
                    >
                      <option value="">- - เลือก - -</option>
                      {JOB_PAYMENT_METHODS.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                      {d.payType && !JOB_PAYMENT_METHODS.includes(d.payType) && <option>{d.payType}</option>}
                    </Select>
                  </Field>
                  <Field label="จำนวนเงินที่ชำระ (บาท)" error={act.errors['payment.amount']}>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={d.payAmount}
                      disabled={!!lock}
                      onChange={(e) => upd({ payAmount: e.target.value })}
                      onFocus={(e) => e.currentTarget.select()}
                      className="num text-right"
                    />
                  </Field>
                  <Field label="วันที่ชำระเงิน" error={act.errors['payment.date']}>
                    <Input
                      type="date"
                      value={d.payDate}
                      disabled={!!lock}
                      onChange={(e) => upd({ payDate: e.target.value })}
                    />
                  </Field>
                  <Field label="เลขที่ใบเสร็จ" error={act.errors['payment.no']}>
                    <Input
                      className="num"
                      maxLength={50}
                      value={d.payNo}
                      disabled={!!lock}
                      onChange={(e) => upd({ payNo: e.target.value })}
                    />
                  </Field>
                  <Field label="สลิปหลักฐานการชำระ" wide>
                    <div className="flex items-center gap-2">
                      <Input
                        type="file"
                        className="h-9 py-1.5 text-xs"
                        accept=".jpg,.jpeg,.png,.webp,.pdf"
                        disabled={!job}
                        onChange={(e) => onPickSlip(e.target.files?.[0])}
                      />
                      {slip && (
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
                  <Field
                    label="หมายเหตุ"
                    wide
                    error={act.errors['payment.detail']}
                    hint={`${d.payDetail.length}/${payDetailMax} ตัวอักษร${d.payDate ? ' (บันทึกพร้อมวันที่ชำระ)' : ''}`}
                  >
                    <Textarea
                      rows={2}
                      maxLength={payDetailMax}
                      value={d.payDetail}
                      disabled={!!lock}
                      onChange={(e) => upd({ payDetail: e.target.value })}
                    />
                  </Field>
                </FieldGrid>
              )}
            </div>
          </Section>
        )}

        <Section title="ข้อมูลการปิดงาน - ส่งคืนสินค้า" icon={PackageCheck}>
          <FieldGrid>
            <Field label="วิธีการส่งคืนสินค้า" required error={act.errors['return.type']}>
              <Select value={d.returnType} onChange={(e) => upd({ returnType: e.target.value })}>
                <option value="">- - Please Select - -</option>
                {RETURN_METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
                {d.returnType && !RETURN_METHODS.includes(d.returnType) && <option>{d.returnType}</option>}
              </Select>
            </Field>
            <Field label="วันที่ส่งคืน" required error={act.errors['return.date']}>
              <Input type="date" value={d.returnDate} onChange={(e) => upd({ returnDate: e.target.value })} />
            </Field>
            <Field
              label="บริษัทขนส่ง"
              hint={d.shipperId ? 'ลูกค้าจะเห็นโลโก้และปุ่มติดตามพัสดุในหน้าติดตามสถานะ' : undefined}
            >
              {/* โปรไฟล์บริษัทขนส่ง (ข้อมูลระบบ) — เลือก "อื่น ๆ" เพื่อพิมพ์ชื่อเองแบบระบบเดิม */}
              <Select
                value={d.shipperId ? String(d.shipperId) : d.courier ? 'other' : ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'other') return upd({ shipperId: 0, courier: '' });
                  const p = SHIPPING.find((x) => String(x.id) === v);
                  upd({ shipperId: p ? p.id : 0, courier: p ? p.nameTh : '' });
                }}
              >
                <option value="">- - เลือก - -</option>
                {/* a profile deleted since (hidden from the list): the job keeps it */}
                {d.shipperId > 0 && !SHIPPING.some((p) => p.id === d.shipperId) && (
                  <option value={d.shipperId}>{d.courier || `#${d.shipperId}`} (ค่าเดิม)</option>
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
                {SHIPPERS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field
              label="หมายเลขพัสดุ"
              required={d.status === STATUS_CLOSED_TRACKED}
              error={act.errors['return.tracking']}
            >
              <Input
                className="num"
                maxLength={50}
                value={d.tracking}
                onChange={(e) => upd({ tracking: e.target.value })}
              />
            </Field>
            <Field
              label="รายละเอียดการส่งคืน"
              wide
              error={act.errors['return.detail']}
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
              error={act.errors.status ?? (outsourceOut ? OUTSOURCE_NOT_BACK : partsWait)}
              hint={
                d.status === STATUS_CLOSED_WAIT_TRACKING && d.tracking.trim()
                  ? `มีหมายเลขพัสดุแล้ว — บันทึกเป็น "${STATUS_CLOSED_TRACKED}"`
                  : undefined
              }
            >
              <Select value={d.status} onChange={(e) => upd({ status: e.target.value })}>
                <option value="">- - Please Select - -</option>
                {CLOSE_STATUS_OPTIONS.map((st) => (
                  <option key={st}>{st}</option>
                ))}
              </Select>
            </Field>
          </FieldGrid>
        </Section>

        <FormActions
          saveLabel="ยืนยันปิดงาน"
          onSave={save}
          saving={saving}
          cancelHref="/jobs/list"
          denied={can('Job Closing', 'edit') ? undefined : VIEW_ONLY}
        />
      </RecordGate>
    </>
  );
}

export default function ClosePage() {
  return (
    <JobScreen>
      <CloseForm />
    </JobScreen>
  );
}
