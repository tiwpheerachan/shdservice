'use client';

import { Wallet } from 'lucide-react';
import { Section } from '@/components/shared/section';
import { Field, FieldGrid } from '@/components/ui/field';
import { FileInput, Input, MoneyInput, Select, Textarea } from '@/components/ui/input';
import { JOB_PAYMENT_METHODS } from '@/data/options';
import { fileUrl } from '@/lib/api';
import { today as thaiToday } from '@/lib/dates';
import type { JobDetail } from '@/lib/use-job';
import { baht } from '@/lib/utils';
import type { FieldErrors } from '@/lib/validation';
import { noteMaxLength, paymentDetailOf, refundDateOf } from '@/lib/validation/job';
import { type Balance, type CloseDraft, costRows, LEGACY_ADJUST_LABEL, netOf } from './close-money';

type Draft = { d: CloseDraft; upd: (p: Partial<CloseDraft>) => void; errors: FieldErrors; lock?: string };

/** รายละเอียดการรับชำระเงิน — the job's costs, then the payment (or the deposit refund) of the close */
export function ClosePaymentSection({
  job,
  bal,
  slip,
  onPickSlip,
  ...draft
}: Draft & {
  job: JobDetail | null;
  bal: Balance;
  /** สลิปชำระเงิน already uploaded (its file path) */
  slip: string;
  onPickSlip: Parameters<typeof FileInput>[0]['onFile'];
}) {
  // money already given back (a swap/refund job stores it as a negative payment): shown as it is, no payment inputs
  // — the hidden fields stay as loaded, so a save sends no payment and the refund is kept
  const gaveBack = job && job.payment.amount < 0 ? job.payment : null;
  const refunded = gaveBack && bal.refund === 0 ? gaveBack : null;
  // how it went back: "เงินสด, 2026-10-01" (the date is in the detail: "คืนมัดจำ <date>")
  const gaveBackHow = gaveBack
    ? [gaveBack.type, gaveBack.no, refundDateOf(gaveBack.detail)].filter(Boolean).join(', ')
    : '';

  return (
    <Section title="รายละเอียดการรับชำระเงิน" icon={Wallet}>
      <div className="grid gap-4 lg:grid-cols-2">
        <CostBreakdown job={job} bal={bal} gaveBack={gaveBack} gaveBackHow={gaveBackHow} />
        {bal.refund > 0 ? (
          <RefundFields {...draft} bal={bal} />
        ) : refunded ? (
          <p role="status" className="self-start rounded-lg border border-border p-4 text-sm font-medium">
            คืนเงินแล้ว <span className="num">{baht(-refunded.amount)}</span> บาท
            {gaveBackHow ? ` (${gaveBackHow})` : ''}
          </p>
        ) : (
          <PaymentFields {...draft} bal={bal} canUpload={!!job} slip={slip} onPickSlip={onPickSlip} />
        )}
      </div>
    </Section>
  );
}

function CostBreakdown({
  job,
  bal,
  gaveBack,
  gaveBackHow,
}: {
  job: JobDetail | null;
  bal: Balance;
  gaveBack: JobDetail['payment'] | null;
  gaveBackHow: string;
}) {
  const SUMMARY = costRows(job);
  const net = netOf(SUMMARY);
  const deposit = job?.depositCost ?? 0;
  return (
    <div role="group" aria-label="ยอดเงินของงาน" className="rounded-lg border border-border bg-muted/30 p-4">
      <ul className="space-y-2 text-sm">
        {SUMMARY.map((s) => (
          <li key={s.label} className="flex justify-between gap-3">
            <span className="text-muted-foreground">{s.label}</span>
            <span className="num">
              {s.label === LEGACY_ADJUST_LABEL && s.v > 0 && '+'}
              {baht(s.v)}
            </span>
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
  );
}

function RefundFields({ d, upd, errors, lock, bal }: Draft & { bal: Balance }) {
  return (
    <FieldGrid cols={2}>
      <Field label="วิธีการคืนเงินมัดจำ" required error={errors['refund.type']} hint={lock}>
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
        error={errors['refund.amount']}
        hint={`ไม่เกิน ${baht(bal.refund)} บาท`}
      >
        <MoneyInput
          max={bal.refund}
          value={d.refAmount}
          disabled={!!lock}
          onChange={(e) => upd({ refAmount: e.target.value })}
        />
      </Field>
      <Field label="วันที่คืนเงิน" required error={errors['refund.date']}>
        <Input type="date" value={d.refDate} disabled={!!lock} onChange={(e) => upd({ refDate: e.target.value })} />
      </Field>
    </FieldGrid>
  );
}

function PaymentFields({
  d,
  upd,
  errors,
  lock,
  bal,
  canUpload,
  slip,
  onPickSlip,
}: Draft & {
  bal: Balance;
  canUpload: boolean;
  slip: string;
  onPickSlip: Parameters<typeof FileInput>[0]['onFile'];
}) {
  // the save puts the payment date in front of the note (one varchar(100))
  const payDetailMax = noteMaxLength((n) => paymentDetailOf(d.payDate, n), d.payDetail);
  return (
    <FieldGrid cols={2}>
      <Field label="วิธีการชำระเงิน" required={bal.due > 0} error={errors['payment.type']} hint={lock}>
        <Select
          name="payType" // the บทสอน reads whether it is locked
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
      <Field label="จำนวนเงินที่ชำระ (บาท)" error={errors['payment.amount']}>
        <MoneyInput value={d.payAmount} disabled={!!lock} onChange={(e) => upd({ payAmount: e.target.value })} />
      </Field>
      <Field label="วันที่ชำระเงิน" error={errors['payment.date']}>
        <Input type="date" value={d.payDate} disabled={!!lock} onChange={(e) => upd({ payDate: e.target.value })} />
      </Field>
      <Field label="เลขที่ใบเสร็จ" error={errors['payment.no']}>
        <Input
          className="num"
          maxLength={50}
          value={d.payNo}
          disabled={!!lock}
          onChange={(e) => upd({ payNo: e.target.value })}
        />
      </Field>
      <Field
        label="สลิปการชำระเงิน"
        wide
        hint={
          lock
            ? 'ล็อกพร้อมช่องเงิน (เหตุผลใต้ วิธีการชำระเงิน)'
            : canUpload
              ? `อัปโหลดแล้วบันทึกเข้าระบบทันที${slip ? ' (แทนที่สลิปเดิม)' : ''}`
              : undefined
        }
      >
        <div className="flex items-center gap-2">
          <FileInput
            placeholder="เลือกไฟล์สลิป (JPG, PNG, WEBP, PDF)"
            accept=".jpg,.jpeg,.png,.webp,.pdf"
            disabled={!canUpload || !!lock}
            onFile={onPickSlip}
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
        error={errors['payment.detail']}
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
  );
}
