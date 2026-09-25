import { notFound } from "next/navigation";
import { getQuotation } from "@/server/services/quotations";
import { AutoPrint } from "@/components/print/auto-print";
import { money } from "@/components/print/print-frame";
import { QUOTATION_VALIDITY } from "@/lib/company";
import { profileForDocument } from "@/server/services/document-profiles";
import { bahtText } from "@/lib/thai-baht";

export const dynamic = "force-dynamic";

const dmy = (s: string) => {
  // "2026-09-17 16:37" / "2026-09-17" → "17-09-2026" (legacy prints dd-mm-yyyy)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s || "";
};
const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const or = (v: string | null | undefined, dash = "") => (v && v.trim() ? v : dash);

/**
 * ใบเสนอราคา — laid out to match the legacy form (setupdata/receipt/Q2600468_163754.pdf):
 * logomark + company text · bilingual boxed header · full-height item table ·
 * bank details + totals with the amount in Thai words · two signature boxes.
 */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const q = await getQuotation(decodeURIComponent(no).toUpperCase());
  if (!q) notFound();
  const co = await profileForDocument(q.documentProfileId); // ออกเอกสารในนาม
  const c = q.customerDetail;
  const j = q.job;

  const partsTotal = q.lines.reduce((s, l) => s + l.total, 0);
  const hasDiscount = (q.discountAmount ?? 0) > 0;
  const contactLine = [q.createdByPhone && `Tel. : ${q.createdByPhone}`, q.createdByEmail && `Email : ${q.createdByEmail}`].filter(Boolean).join("  ");
  const engineer = j?.engineer?.trim() || q.createdBy;
  const model = j ? [j.brand, j.modelName].filter(Boolean).join(" ") : q.brandModel;
  const lbl = "text-neutral-700";

  return (
    <div className="print-page qt text-[11.5px] leading-[1.35] text-black">
      <AutoPrint />
      <style>{`
        .qt table { border-collapse: collapse; width: 100%; }
        .qt th, .qt td { border: 0; padding: 0; background: transparent; font-weight: inherit; vertical-align: top; }
        .qt .grid-b { border: 1px solid #000; }
        /* explicit cell rules — Tailwind border/padding utilities lose to the .qt td reset above */
        .qt td.pad { padding: 4px 8px 3px; }
        .qt td.sig { padding: 8px 12px; }
        .qt td.br { border-right: 1px solid #000; }
        .qt td.bt { border-top: 1px solid #000; }
        .qt .kv td { padding: 1px 0; }
        .qt .kv td.k { width: 92px; text-align: right; padding-right: 8px; white-space: nowrap; }
        .qt .kv td.gap { padding-top: 8px; }
        .qt .items th { border: 1px solid #000; padding: 2px 4px; text-align: center; font-weight: 600; }
        .qt .items td { border-left: 1px solid #000; border-right: 1px solid #000; padding: 2px 5px; }
        .qt .items tbody tr:first-child td { padding-top: 4px; }
        .qt .sum td { border: 1px solid #000; padding: 2px 5px; }
        .qt .sum td.words { background: #d4d4d4; }
        /* the item table stretches so the page is always one full A4 like the legacy form */
        .qt { display: flex; flex-direction: column; }
        .qt .items-wrap { flex: 1 1 auto; display: flex; flex-direction: column; }
        .qt .items { flex: 1 1 auto; height: 100%; }
        .qt .items tbody tr.fill { height: 100%; }
        .qt .items tbody tr.fill td { height: 100%; }
        @media print { .qt { padding: 10mm 12mm 12mm; min-height: 296mm; } } /* a hair under A4 so rounding never spills a blank 2nd page */
      `}</style>

      {/* ── company header ── */}
      <header className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={co.logoUrl} alt={co.code} className="h-[38px] w-auto shrink-0" />
        <div className="leading-[1.3]">
          <p className="text-[14px] font-bold">{co.nameTh}</p>
          <p>{co.address}</p>
          <p>
            โทรศัพท์ {co.phone}&nbsp;&nbsp;เลขประจำตัวผู้เสียภาษีอากร&nbsp;&nbsp;<span className="num">{co.taxId || "xxxxxxxxxxxxx"}</span>
          </p>
        </div>
      </header>

      <div className="mt-3 flex items-end justify-between">
        <span />
        <h1 className="text-[15px] font-bold">ใบเสนอราคา / QUOTATION</h1>
        <span className="text-[10.5px]">Page : 1 / 1</span>
      </div>

      {/* ── customer / job boxes ── */}
      <table className="grid-b mt-1.5">
        <tbody>
          <tr>
            <td className="w-[58%] br pad">
              <p className={lbl}>เรียน / Attention :</p>
              <div className="ml-6 mt-0.5 min-h-[44px]">
                <p>{or(c?.name ?? q.customer)}</p>
                <p>{or(c?.address)}</p>
              </div>
              <div className="mt-1.5 flex gap-10">
                <span>
                  <span className={lbl}>Tel :</span>&nbsp;&nbsp;<span className="num">{or(c?.phone)}</span>
                </span>
                <span>
                  <span className={lbl}>เลขผู้เสียภาษี :</span>&nbsp;&nbsp;<span className="num">{or(c?.taxId)}</span>
                </span>
              </div>
            </td>
            <td className="pad" rowSpan={2}>
              <table className="kv">
                <tbody>
                  <tr>
                    <td className="k font-semibold">งานซ่อม :</td>
                    <td className="num font-semibold">{or(q.jobRef)}</td>
                  </tr>
                  <tr>
                    <td className="k">Model :</td>
                    <td>{or(model)}</td>
                  </tr>
                  <tr>
                    <td className="k">Ref. SO No. :</td>
                    <td className="num">{or(j?.so)}</td>
                  </tr>
                  <tr>
                    <td className="k">IMEI No. :</td>
                    <td className="num">{or(j ? [j.imei, j.serial].filter(Boolean).join(" / ") : q.imei)}</td>
                  </tr>
                  <tr>
                    <td className="k gap">ช่าง :</td>
                    <td className="gap">{or(engineer)}</td>
                  </tr>
                  <tr>
                    <td className="k gap">หมายเหตุ :</td>
                    <td className="gap whitespace-pre-line">{or(q.remark)}</td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
          <tr>
            <td className="bt br">
              <table>
                <tbody>
                  <tr>
                    <td className="w-1/2 br pad">
                      <p>
                        <span className="font-semibold">เลขที่ / No. :</span>&nbsp;&nbsp;<span className="num font-semibold">{q.no}</span>
                      </p>
                      <p className="mt-0.5">
                        <span className={lbl}>วันที่ / Date :</span>&nbsp;&nbsp;<span className="num">{dmy(q.date)}</span>
                      </p>
                    </td>
                    <td className="pad text-center">
                      <p className="font-semibold">กำหนดยืนยันราคา</p>
                      <p className="mt-0.5">Validity date : {QUOTATION_VALIDITY}</p>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mt-1.5 text-center text-[10px]">
        บริษัทฯ ขอเรียนแจ้งเสนอราคาและเงื่อนไขสำหรับท่านดังนี้ / We are please to submit you the following described here in at price, items and terms stated.
      </p>

      {/* ── items ── */}
      <div className="items-wrap mt-1">
      <table className="items">
        <thead>
          <tr>
            <th className="w-[44px]">ลำดับ<br />No.</th>
            <th>รายการ<br />Description</th>
            <th className="w-[62px]">จำนวน<br />Qty.</th>
            <th className="w-[92px]">ราคาต่อหน่วย<br />Unit Price</th>
            <th className="w-[92px]">จำนวนเงิน<br />Amount</th>
          </tr>
        </thead>
        <tbody>
          {q.lines.map((l, i) => (
            <tr key={l.id ?? i}>
              <td className="num text-center">{i + 1}</td>
              <td>
                {l.code && <span className="num">{l.code} </span>}
                {l.detail}
              </td>
              <td className="num text-center">{l.qty}</td>
              <td className="num text-right">{money(l.unitPrice)}</td>
              <td className="num text-right">{money(l.total)}</td>
            </tr>
          ))}
          {/* filler row keeps the table full-height like the legacy form */}
          <tr className="fill">
            <td /><td /><td /><td /><td />
          </tr>
        </tbody>
      </table>
      </div>

      {/* ── bank details + totals ── */}
      <table className="sum">
        <tbody>
          <tr>
            <td rowSpan={hasDiscount ? 5 : 4} style={{ width: "58%" }}>
              <p>รายละเอียดการโอนเงินชำระค่าสินค้าและบริการผ่านบัญชีบริษัทฯ ดังนี้</p>
              <p className="mt-1 text-[10.5px]">
                1. {co.bankName || "—"} {co.bankAccountType} เลขที่&nbsp;&nbsp;<span className="num">{co.bankAccountNo || "XXXXXXX"}</span>
                {co.bankAccountName ? ` ชื่อบัญชี ${co.bankAccountName}` : ""}
              </p>
            </td>
            <td className="w-[154px] text-right font-semibold">รวมเงิน / Total :</td>
            <td className="num w-[92px] text-right">{money(partsTotal)}</td>
          </tr>
          <tr>
            <td className="text-right font-semibold">ค่าบริการ / Service :</td>
            <td className="num text-right">{money(q.serviceAmount ?? 0)}</td>
          </tr>
          {hasDiscount && (
            <tr>
              <td className="text-right font-semibold">ส่วนลด / Discount {q.discountType !== "ไม่มีส่วนลด" ? `(${q.discountFormula})` : ""} :</td>
              <td className="num text-right">-{money(q.discountAmount ?? 0)}</td>
            </tr>
          )}
          <tr>
            <td className="text-right font-semibold">รวมเงิน / Total :</td>
            <td className="num text-right">{money(q.totalBase)}</td>
          </tr>
          <tr>
            <td className="text-right font-semibold">VAT {q.vatRate}% :</td>
            <td className="num text-right">{money(q.vatAmount ?? 0)}</td>
          </tr>
          <tr>
            <td className="words text-center font-semibold">({bahtText(q.netAmount)})</td>
            <td className="text-right font-bold">รวมทั้งสิ้น / Grand Total :</td>
            <td className="num text-right font-bold">{money(q.netAmount)}</td>
          </tr>
        </tbody>
      </table>

      <p className="mt-1.5 flex justify-between gap-4 text-[10.5px]">
        <span>ท่านสามารถติดต่อสอบถามข้อมูลเพิ่มเติมเกี่ยวกับใบเสนอราคานี้ได้ที่</span>
        <span className="num">{contactLine}</span>
      </p>

      {/* ── signatures ── */}
      <table className="grid-b mt-1.5">
        <tbody>
          <tr>
            <td className="w-[58%] br sig text-center">
              <p className="text-[10.5px]">กรุณาลงนามยืนยันการตกลงซ่อม และส่งใบเสนอราคาฉบับนี้มาที่</p>
              <p className="mt-1">Email : {q.createdByEmail || co.email || "—"}</p>
              <p className="mt-3 font-semibold">ตกลงซ่อมโดย</p>
              <p className="mx-auto mt-6 flex w-[240px] justify-between border-t border-black pt-0.5"><span>(</span><span>)</span></p>
              <p className="mt-2">วันที่ <span className="inline-block w-[120px] border-b border-black text-center">&nbsp;/&nbsp;&nbsp;&nbsp;&nbsp;/&nbsp;</span></p>
            </td>
            <td className="sig">
              <p className="text-center font-semibold">ในนาม<br />{co.nameTh}</p>
              <div className="mt-5 flex items-end gap-2">
                <span className="font-semibold">เสนอราคาโดย :</span>
                <span className="flex-1 border-b border-black" />
              </div>
              <p className="mt-1 text-center">( {or(q.createdBy, "—")} )</p>
              <p className="num mt-2 text-center text-[10px]">{contactLine}</p>
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mt-2 text-[9.5px]">Printing Date : {stamp()}</p>
    </div>
  );
}
