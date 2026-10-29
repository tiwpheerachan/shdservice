import { AutoPrint } from '@/components/print/auto-print';
import { money } from '@/components/print/print-frame';
import { pickSlips } from '@/server/services/quotations';
import { pickSlipProfile, profileForDocument } from '@/server/services/document-profiles';

/** the legacy slip's ruled rows — fewer lines are padded with empty ones */
const ROWS = 13;

/**
 * ใบเบิกสินค้า — laid out as the legacy slip (owner's sample 2026-10-29): A4 landscape, one quotation per page.
 * Header = the pick slip profile (IPA, document_profile.purpose = 'pick_slip'), else the quotation's own issuer.
 * Lines and totals: pickSlips (src/server/services/quotations.ts). A skipped quotation is named on screen only.
 */
export async function PickSlipDoc({ nos }: { nos: string[] }) {
  const [{ slips, skipped }, header] = await Promise.all([pickSlips(nos), pickSlipProfile()]);
  const note = skipped.length > 0 && (
    <p className="no-print mx-auto mb-3 w-[297mm] rounded border border-amber-500 bg-amber-50 px-4 py-2 text-sm">
      ไม่พิมพ์ {skipped.length} ใบ: {skipped.map((s) => `${s.no} (${s.why})`).join(', ')}
    </p>
  );
  if (!slips.length)
    return (
      <main className="mx-auto w-[297mm] bg-white p-8 text-black">
        <h1 className="text-lg font-bold">ใบเบิกสินค้า</h1>
        {note || <p className="mt-2">ไม่ได้เลือกใบเสนอราคา</p>}
        <p className="mt-2">ไม่มีใบเสนอราคาที่พิมพ์ใบเบิกสินค้าได้</p>
      </main>
    );
  const companies = await Promise.all(
    slips.map(async ({ q }) => (header ?? (await profileForDocument(q.documentProfileId))).nameTh),
  );

  return (
    <main className="ps text-[12px] leading-[1.35] text-black">
      <style>{`
        @page { size: A4 landscape; margin: 10mm; }
        .ps-sheet { width: 297mm; min-height: 210mm; margin: 0 auto 6mm; padding: 10mm 12mm; background: #fff; box-shadow: 0 2px 12px rgb(0 0 0 / 0.15); }
        .ps table { border-collapse: collapse; width: 100%; }
        .ps td, .ps th { border: 1px solid #000; padding: 3px 6px; font-weight: inherit; background: transparent; }
        .ps .items th { text-align: center; font-weight: 600; }
        .ps .items tbody tr { height: 22px; }
        .ps .sign td, .ps .sign { border: 0; }
        @media print {
          .ps-sheet { width: auto; min-height: auto; margin: 0; padding: 0; box-shadow: none; break-after: page; }
          .ps-sheet:last-child { break-after: auto; }
        }
      `}</style>
      <div className="mx-auto w-[297mm]">
        <AutoPrint paper="A4 แนวนอน" />
      </div>
      {note}
      {slips.map(({ q, lines, qty, parts }, k) => {
        const j = q.job;
        return (
          <section key={q.no} className="ps-sheet">
            <header className="flex items-start justify-between">
              <p className="text-[15px] font-bold">{companies[k]}</p>
              <h1 className="text-[18px] font-bold">ใบเบิกสินค้า</h1>
            </header>
            <table className="mt-3">
              <tbody>
                <tr>
                  <td className="w-[65%]">
                    หมายเลขงานซ่อม : <span className="num font-semibold">{q.jobRef || '-'}</span>
                  </td>
                  <td>
                    หมายเลขใบเสนอราคา : <span className="num font-semibold">{q.no}</span>
                  </td>
                </tr>
                <tr>
                  <td>
                    Model : {j?.modelName || q.brandModel || '-'}&nbsp;&nbsp; Imei :{' '}
                    <span className="num">{j?.imei || q.imei || '-'}</span>&nbsp;&nbsp; ชื่อช่าง :{' '}
                    {j?.engineer?.trim() || '-'}
                  </td>
                  <td>
                    วันที่ : <span className="num">{q.date.slice(0, 10)}</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <table className="items mt-3">
              <thead>
                <tr>
                  <th className="w-[40px]">#</th>
                  <th className="w-[150px]">รหัสสินค้า</th>
                  <th>รายการ</th>
                  <th className="w-[80px]">จำนวน</th>
                  <th className="w-[120px]">ราคาต่อหน่วย</th>
                  <th className="w-[120px]">จำนวนเงิน</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.id ?? i}>
                    <td className="num text-center">{i + 1}</td>
                    <td className="num">{l.code}</td>
                    <td>{l.detail}</td>
                    <td className="num text-center">{l.qty}</td>
                    <td className="num text-right">{money(l.unitPrice)}</td>
                    <td className="num text-right">{money(l.total)}</td>
                  </tr>
                ))}
                {Array.from({ length: Math.max(0, ROWS - lines.length) }, (_, i) => (
                  <tr key={`pad${i}`}>
                    <td />
                    <td />
                    <td />
                    <td />
                    <td />
                    <td />
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td colSpan={3} className="text-right">
                    รวม
                  </td>
                  <td className="num text-center">{qty}</td>
                  <td />
                  <td className="num text-right">{money(parts)}</td>
                </tr>
              </tbody>
            </table>
            <div className="mt-4 flex items-start justify-between gap-6">
              <div className="grid min-w-0 flex-1 grid-cols-3 gap-4 pt-6 text-center">
                {['ผู้เบิกสินค้า', 'ผู้รับสินค้า', 'ผู้อนุมัติ'].map((who) => (
                  <div key={who}>
                    <p>ลงชื่อ ...................................... {who}</p>
                    <p className="mt-3">วันที่ ......../........../..........</p>
                  </div>
                ))}
              </div>
              {/* the quotation's stored amounts — the same as its own print (a fixed box: .ps table is 100% wide) */}
              <div className="w-[330px] shrink-0">
                <table>
                  <tbody>
                    <tr>
                      <td className="text-right font-semibold">ค่าบริการ / Service :</td>
                      <td className="num w-[110px] text-right">{money(q.serviceAmount ?? 0)}</td>
                    </tr>
                    <tr>
                      <td className="text-right font-semibold">รวมเงิน / Total :</td>
                      <td className="num text-right">{money(q.totalBase)}</td>
                    </tr>
                    <tr>
                      <td className="text-right font-semibold">VAT {q.vatRate} % :</td>
                      <td className="num text-right">{money(q.vatAmount ?? 0)}</td>
                    </tr>
                    <tr>
                      <td className="text-right font-bold">รวมทั้งสิ้น / Grand Total :</td>
                      <td className="num text-right font-bold">{money(q.netAmount)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        );
      })}
    </main>
  );
}
