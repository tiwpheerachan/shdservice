'use client';

import { Field, FieldGrid } from '@/components/ui/field';
import { Input, Textarea, NumberInput, Select } from '@/components/ui/input';
import { SearchSelect, strOptions, withCurrent } from '@/components/shared/search-select';
import { useQuotationStatuses } from '@/data/db';
import { QUOTATION_STATUS_OPTIONS } from '@/data/options';
import { baht } from '@/lib/utils';
import type { FieldErrors } from '@/lib/validation';
import type { computeTotals } from '@/lib/validation/quotation';

/** หมายเหตุ + สถานะใบเสนอราคา (+ a loaded quotation's วันที่ลูกค้าตอบรับ / สร้างโดย) */
export function QuotationStatusFields({
  remark,
  setRemark,
  status,
  onStatus,
  jobNote,
  loaded,
  errors,
}: {
  remark: string;
  setRemark: (v: string) => void;
  status: string;
  onStatus: (v: string) => void;
  /** why this status leaves the job where it is ('' = it moves the job) */
  jobNote: string;
  /** a loaded quotation */
  loaded?: { approveDate?: string; createdBy?: string } | null;
  errors: FieldErrors;
}) {
  const { data: STATUSES } = useQuotationStatuses();
  return (
    <FieldGrid cols={2}>
      <Field label="หมายเหตุ" wide error={errors.remark}>
        <Textarea
          rows={4}
          maxLength={1000}
          placeholder="เงื่อนไขการเสนอราคา ระยะเวลายืนราคา ฯลฯ"
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
        />
      </Field>
      {/* a new sent / agreed status moves the job forward only — say so when this job stays where it is */}
      <Field label="สถานะใบเสนอราคา" wide hint={jobNote || undefined}>
        <SearchSelect
          value={status}
          onChange={onStatus}
          options={withCurrent(
            strOptions(STATUSES.length ? STATUSES.map((x) => x.name) : QUOTATION_STATUS_OPTIONS),
            status,
          )}
        />
      </Field>
      {loaded && (
        <>
          {/* quotation_hd.customer_approve_date — stamped by the server the first time the customer agrees */}
          <Field label="วันที่ลูกค้าตอบรับ">
            <Input readOnly className="num" value={loaded.approveDate || '—'} />
          </Field>
          <Field label="สร้างโดย">
            <Input readOnly value={loaded.createdBy || '—'} />
          </Field>
        </>
      )}
    </FieldGrid>
  );
}

/** the money card: parts / service / delivery, discount, VAT and the net (computeTotals = the server's rules) */
export function QuotationSummary({
  partsTotal,
  deliveryTotal,
  t,
  service,
  setService,
  discountType,
  discount,
  setDiscount,
  discountUnit,
  setDiscountUnit,
  vatRate,
  setVatRate,
  errors,
  clear,
  showZero,
}: {
  partsTotal: number;
  deliveryTotal: number;
  t: ReturnType<typeof computeTotals>;
  service: number;
  setService: (n: number) => void;
  discountType: string;
  discount: number;
  setDiscount: (n: number) => void;
  discountUnit: 'บาท' | '%';
  setDiscountUnit: (u: 'บาท' | '%') => void;
  vatRate: number;
  setVatRate: (n: number) => void;
  errors: FieldErrors;
  clear: (key: string) => void;
  /** a loaded quotation shows its 0 amounts as 0 */
  showZero: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <dl className="space-y-2 text-sm">
        <Row label="รวมค่าอะไหล่" value={baht(partsTotal)} />
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">ค่าบริการ</dt>
          {/* every value of a <dl> row sits in a <dd> — an input too */}
          <dd>
            <NumberInput
              aria-label="ค่าบริการ"
              aria-invalid={!!errors.serviceAmount || undefined}
              step="0.01"
              showZero={showZero}
              value={service}
              onChange={(n) => {
                setService(n);
                clear('serviceAmount');
              }}
              className="h-8 w-32 text-xs"
            />
          </dd>
        </div>
        {deliveryTotal > 0 && <Row label="ค่าขนส่ง" value={baht(deliveryTotal)} />}
        <Row label="รวมเป็นเงิน" value={baht(t.sumExclude)} />
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{discountType === 'ส่วนลดรวม' ? 'ส่วนลด' : discountType}</dt>
          <dd className="flex gap-1">
            <NumberInput
              aria-label={`ส่วนลด (${discountUnit})`}
              aria-invalid={!!errors.discountValue || undefined}
              step="0.01"
              placeholder="0"
              showZero={showZero}
              value={discount}
              onChange={(n) => {
                setDiscount(n);
                clear('discountValue');
              }}
              className="h-8 w-24 text-xs"
            />
            <Select
              aria-label="หน่วยส่วนลด"
              value={discountUnit}
              onChange={(e) => {
                setDiscountUnit(e.target.value === 'บาท' ? 'บาท' : '%');
                clear('discountValue');
              }}
              className="h-8 w-20 text-xs"
            >
              <option value="%">%</option>
              <option value="บาท">บาท</option>
            </Select>
          </dd>
        </div>
        <Row label="ส่วนลดเป็นเงิน" value={baht(t.discount)} />
        <Row label="มูลค่าก่อนภาษี" value={baht(t.totalBase)} />
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">ภาษีมูลค่าเพิ่ม (%)</dt>
          {/* 0 or 7 % only (quotation_hd.vat_rate) */}
          <dd>
            <Select
              aria-label="ภาษีมูลค่าเพิ่ม (%)"
              aria-invalid={!!errors.vatRate || undefined}
              value={String(vatRate)}
              onChange={(e) => {
                setVatRate(Number(e.target.value));
                clear('vatRate');
              }}
              className="h-8 w-32 text-xs"
            >
              <option value="0">0</option>
              <option value="7">7</option>
            </Select>
          </dd>
        </div>
        <Row label="ภาษีมูลค่าเพิ่ม" value={baht(t.vat)} />
        <div className="flex justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
          <dt>รวมเป็นเงินสุทธิ</dt>
          <dd className="num text-primary">{baht(t.net)} ฿</dd>
        </div>
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
