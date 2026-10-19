import type { JobDetail } from '@/lib/use-job';
import { CLOSE_STATUS_OPTIONS } from '@/data/options';
import { refundDateOf, type jobBalance } from '@/lib/validation/job';

/** ปิดงาน's own fields: payment / deposit refund / return / new status */
export type CloseDraft = {
  payType: string;
  payAmount: string;
  payDate: string;
  payNo: string;
  payDetail: string;
  refType: string;
  refAmount: string;
  refDate: string;
  returnType: string;
  returnDate: string;
  courier: string;
  shipperId: number;
  tracking: string;
  returnDetail: string;
  status: string;
};

export const EMPTY_CLOSE: CloseDraft = {
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
};

/** editing a field clears its error (keys = the payload paths the rules report) */
export const CLOSE_ERR_KEY: Partial<Record<keyof CloseDraft, string>> = {
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

export type Balance = ReturnType<typeof jobBalance>;

/** the date saved inside job_payment_detail ("ชำระ <date> · …") */
export const payDateOf = (detail: string) => /^ชำระ (\d{4}-\d{2}-\d{2})/.exec(detail)?.[1] ?? '';

/** cost summary straight from the job row */
export const costRows = (job: JobDetail | null | undefined) => [
  { label: 'รวมค่าอะไหล่', v: job?.partsCost ?? 0 },
  { label: 'ค่าบริการการซ่อม', v: job?.serviceCost ?? 0 },
  { label: 'ค่าเครื่องมือพิเศษ', v: job?.toolCost ?? 0 },
  { label: 'ค่าขนส่ง', v: job?.deliveryCost ?? 0 },
  { label: 'ค่ากล่องพัสดุ', v: job?.boxCost ?? 0 },
];

/** รวมเป็นเงินสุทธิ of costRows */
export const netOf = (rows: { v: number }[]) => rows.reduce((s, x) => s + x.v, 0);

/** the close fields as the job stores them (prefill) — `today`: the default refund / return date */
export function closeDraftOf(job: JobDetail, shippers: string[], today: string): CloseDraft {
  return {
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
      : (shippers.find((c) => job.return.detail.includes(c)) ?? ''),
    shipperId: job.return.shipperId ?? 0,
    tracking: job.return.tracking,
    returnDetail: job.return.detail,
    status: CLOSE_STATUS_OPTIONS.includes(job.status) ? job.status : '',
  };
}
