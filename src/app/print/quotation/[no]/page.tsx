import { notFound } from "next/navigation";
import { getQuotation } from "@/server/services/quotations";
import { PrintFrame, Box, KV, Signatures, money } from "@/components/print/print-frame";
import { QUOTATION_TERMS } from "@/lib/company";

export const dynamic = "force-dynamic";

/** ใบเสนอราคา */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const q = await getQuotation(decodeURIComponent(no).toUpperCase());
  if (!q) notFound();
  const c = q.customerDetail;
  const j = q.job;
  return (
    <PrintFrame
      title="ใบเสนอราคา"
      docNo={q.no}
      meta={[
        { label: "วันที่", value: q.date },
        { label: "ประเภท", value: q.type },
        { label: "อ้างถึงงานซ่อม", value: q.jobRef },
        { label: "สถานะ", value: q.status },
      ]}
    >
      <div className="grid grid-cols-2 gap-4">
        <Box title="เสนอต่อ (ลูกค้า)">
          <KV
            items={[
              { k: "รหัสลูกค้า", v: c?.code ?? q.customerCode },
              { k: "ชื่อ", v: c?.name ?? q.customer },
              { k: "ที่อยู่", v: c?.address },
              { k: "โทรศัพท์", v: c?.phone },
              { k: "เลขผู้เสียภาษี", v: c?.taxId },
              { k: "ผู้ติดต่อ", v: q.contactName },
            ]}
          />
        </Box>
        <Box title="เครื่องที่ซ่อม">
          <KV
            items={[
              { k: "ยี่ห้อ / รุ่น", v: j ? [j.brand, j.modelName].filter(Boolean).join(" ") : q.brandModel },
              { k: "Serial / IMEI", v: j ? [j.serial, j.imei].filter(Boolean).join(" / ") : q.imei },
              { k: "การรับประกัน", v: q.warranty === "IN" ? "ในประกัน" : q.warranty === "OUT" ? "นอกประกัน" : q.warranty },
              { k: "อาการเสีย", v: j?.symptoms.join(", ") || j?.symptomOther },
              { k: "อาการที่ตรวจพบ", v: j?.engineerSymptom },
            ]}
          />
        </Box>
      </div>

      <Box title="รายการ">
        <table>
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th className="w-24">รหัส</th>
              <th>รายการ</th>
              <th className="w-16 text-right">จำนวน</th>
              <th className="w-14">หน่วย</th>
              <th className="w-24 text-right">ราคา/หน่วย</th>
              <th className="w-24 text-right">รวม</th>
            </tr>
          </thead>
          <tbody>
            {q.lines.map((l, i) => (
              <tr key={l.id ?? i}>
                <td className="num">{i + 1}</td>
                <td className="num">{l.code}</td>
                <td>{l.detail}</td>
                <td className="num text-right">{l.qty}</td>
                <td>{l.unit}</td>
                <td className="num text-right">{money(l.unitPrice)}</td>
                <td className="num text-right">{money(l.total)}</td>
              </tr>
            ))}
            {q.serviceAmount ? (
              <tr>
                <td className="num">{q.lines.length + 1}</td>
                <td />
                <td>ค่าบริการการซ่อม</td>
                <td className="num text-right">1</td>
                <td>งาน</td>
                <td className="num text-right">{money(q.serviceAmount)}</td>
                <td className="num text-right">{money(q.serviceAmount)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div className="ml-auto mt-2 w-72">
          <table>
            <tbody>
              <tr><td>รวมเป็นเงิน</td><td className="num w-28 text-right">{money(q.sumExclude)}</td></tr>
              <tr><td>ส่วนลด {q.discountType !== "ไม่มีส่วนลด" ? `(${q.discountFormula})` : ""}</td><td className="num text-right">{money(q.discountAmount ?? 0)}</td></tr>
              <tr><td>มูลค่าก่อนภาษี</td><td className="num text-right">{money(q.totalBase)}</td></tr>
              <tr><td>ภาษีมูลค่าเพิ่ม {q.vatRate}%</td><td className="num text-right">{money(q.vatAmount ?? 0)}</td></tr>
              <tr className="font-semibold"><td>จำนวนเงินรวมทั้งสิ้น</td><td className="num text-right">{money(q.netAmount)}</td></tr>
            </tbody>
          </table>
        </div>
      </Box>

      <Box title="หมายเหตุ / เงื่อนไข">
        {q.remark && <p className="mb-1 whitespace-pre-line">{q.remark}</p>}
        <ol className="list-decimal space-y-0.5 pl-5 text-[11px]">
          {QUOTATION_TERMS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
      </Box>

      <Signatures left="ผู้เสนอราคา" right="ลูกค้าอนุมัติ (ลงชื่อ)" />
    </PrintFrame>
  );
}
