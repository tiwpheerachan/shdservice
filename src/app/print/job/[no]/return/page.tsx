import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appUser } from "@/db/schema";
import { getJob } from "@/server/services/jobs";
import { AutoPrint } from "@/components/print/auto-print";
import { money } from "@/components/print/print-frame";
import { COMPANY, RETURN_TERMS } from "@/lib/company";
import { bahtText } from "@/lib/thai-baht";

export const dynamic = "force-dynamic";

const dmy = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s || "";
};
const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const or = (v: string | null | undefined, dash = "") => (v && v.trim() ? v : dash);
const warrantyLabel = (w: string) => (w === "IN" ? "ในประกัน" : w === "OUT" ? "นอกประกัน" : w);

/**
 * ใบส่งคืนสินค้า / RETURN & REPAIR NOTE — same form language as the quotation
 * (logomark header · boxed bilingual header · full-height table · totals with
 * the amount in words · two signature boxes) plus a repair-result block and the
 * return / payment details. Printed from the close-job screen.
 */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const j = await getJob(decodeURIComponent(no).toUpperCase());
  if (!j) notFound();
  const c = j.customer;
  const parts = j.parts.filter((p) => p.statusId === 3 || p.granted > 0);
  const [eng] = j.engineerId > 0
    ? await db.select({ phone: appUser.phoneNo, email: appUser.emailAddress }).from(appUser).where(eq(appUser.userId, j.engineerId)).limit(1)
    : [undefined];
  const contactLine = [eng?.phone && `Tel. : ${eng.phone}`, eng?.email && `Email : ${eng.email}`].filter(Boolean).join("  ");
  const shipping = j.deliveryCost + j.boxCost;
  const lbl = "text-neutral-700";

  return (
    <div className="print-page qt text-[11.5px] leading-[1.35] text-black">
      <AutoPrint />
      <style>{`
        .qt table { border-collapse: collapse; width: 100%; }
        .qt th, .qt td { border: 0; padding: 0; background: transparent; font-weight: inherit; vertical-align: top; }
        .qt .grid-b { border: 1px solid #000; }
        .qt td.pad { padding: 4px 8px 3px; }
        .qt td.sig { padding: 8px 12px; }
        .qt td.br { border-right: 1px solid #000; }
        .qt td.bt { border-top: 1px solid #000; }
        .qt .kv td { padding: 1px 0; }
        .qt .kv td.k { width: 104px; text-align: right; padding-right: 8px; white-space: nowrap; }
        .qt .kv td.gap { padding-top: 6px; }
        .qt .res td { padding: 2px 8px; }
        .qt .res td.k { width: 110px; white-space: nowrap; color: #404040; }
        .qt .items th { border: 1px solid #000; padding: 2px 4px; text-align: center; font-weight: 600; }
        .qt .items td { border-left: 1px solid #000; border-right: 1px solid #000; padding: 2px 5px; }
        .qt .items tbody tr:first-child td { padding-top: 4px; }
        .qt .sum > tbody > tr > td { border: 1px solid #000; padding: 2px 5px; }
        .qt .sum td.words { background: #d4d4d4; }
        .qt { display: flex; flex-direction: column; }
        .qt .items-wrap { flex: 1 1 auto; display: flex; flex-direction: column; }
        .qt .items { flex: 1 1 auto; height: 100%; }
        .qt .items tbody tr.fill { height: 100%; }
        .qt .items tbody tr.fill td { height: 100%; }
        @media print { .qt { padding: 10mm 12mm 12mm; min-height: 296mm; } }
      `}</style>

      {/* ── company header ── */}
      <header className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={COMPANY.logoMark} alt="SHD" className="h-[38px] w-auto shrink-0" />
        <div className="leading-[1.3]">
          <p className="text-[14px] font-bold">{COMPANY.nameTh}</p>
          <p>{COMPANY.address}</p>
          <p>
            โทรศัพท์ {COMPANY.phone}&nbsp;&nbsp;เลขประจำตัวผู้เสียภาษีอากร&nbsp;&nbsp;<span className="num">{COMPANY.taxId || "xxxxxxxxxxxxx"}</span>
          </p>
        </div>
      </header>

      <div className="mt-3 flex items-end justify-between">
        <span />
        <h1 className="text-[15px] font-bold">ใบส่งคืนสินค้า / RETURN &amp; REPAIR NOTE</h1>
        <span className="text-[10.5px]">Page : 1 / 1</span>
      </div>

      {/* ── customer / job boxes ── */}
      <table className="grid-b mt-1.5">
        <tbody>
          <tr>
            <td className="w-[58%] br pad">
              <p className={lbl}>เรียน / Attention :</p>
              <div className="ml-6 mt-0.5 min-h-[44px]">
                <p>{or(c?.name ?? j.customerDetail)}</p>
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
                    <td className="num font-semibold">{j.no}</td>
                  </tr>
                  <tr>
                    <td className="k">Model :</td>
                    <td>{or([j.brand, j.modelName].filter(Boolean).join(" "))}</td>
                  </tr>
                  <tr>
                    <td className="k">IMEI / Serial :</td>
                    <td className="num">{or([j.imei, j.serial].filter(Boolean).join(" / "))}</td>
                  </tr>
                  <tr>
                    <td className="k">การรับประกัน :</td>
                    <td>{or(warrantyLabel(j.warranty))}</td>
                  </tr>
                  <tr>
                    <td className="k gap">ช่าง :</td>
                    <td className="gap">{or(j.engineer)}</td>
                  </tr>
                  <tr>
                    <td className="k">อ้างอิงใบเสนอราคา :</td>
                    <td className="num">{or(j.quotationNo)}</td>
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
                        <span className="font-semibold">เลขที่ / No. :</span>&nbsp;&nbsp;<span className="num font-semibold">{j.no}</span>
                      </p>
                      <p className="mt-0.5">
                        <span className={lbl}>วันที่ปิดงาน / Date :</span>&nbsp;&nbsp;<span className="num">{dmy(j.closedDate) || "—"}</span>
                      </p>
                    </td>
                    <td className="pad">
                      <p>
                        <span className={lbl}>วันที่รับเครื่อง :</span>&nbsp;&nbsp;<span className="num">{dmy(j.createDate)}</span>
                      </p>
                      <p className="mt-0.5">
                        <span className={lbl}>วันที่ซ่อมเสร็จ :</span>&nbsp;&nbsp;<span className="num">{dmy(j.repairedDate) || "—"}</span>
                      </p>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── repair result ── */}
      <table className="grid-b res mt-1.5">
        <tbody>
          <tr>
            <td className="k pt-1">อาการที่แจ้ง :</td>
            <td className="pt-1">{or(j.symptoms.join(", ") || j.symptomOther, "—")}</td>
          </tr>
          <tr>
            <td className="k">อาการที่ตรวจพบ :</td>
            <td>{or(j.engineerSymptom, "—")}</td>
          </tr>
          <tr>
            <td className="k pb-1">วิธีการซ่อม :</td>
            <td className="whitespace-pre-line pb-1">{or(j.repairDetail, "—")}{j.engineerRemark ? ` (${j.engineerRemark})` : ""}</td>
          </tr>
        </tbody>
      </table>

      {/* ── parts ── */}
      <div className="items-wrap mt-1.5">
      <table className="items">
        <thead>
          <tr>
            <th className="w-[44px]">ลำดับ<br />No.</th>
            <th>รายการอะไหล่ที่เปลี่ยน<br />Description</th>
            <th className="w-[62px]">จำนวน<br />Qty.</th>
            <th className="w-[92px]">ราคาต่อหน่วย<br />Unit Price</th>
            <th className="w-[92px]">จำนวนเงิน<br />Amount</th>
          </tr>
        </thead>
        <tbody>
          {parts.length === 0 && (
            <tr>
              <td /><td className="text-neutral-500">— ไม่มีการเปลี่ยนอะไหล่ —</td><td /><td /><td />
            </tr>
          )}
          {parts.map((p, i) => {
            const qty = p.granted || p.requested;
            return (
              <tr key={p.logId}>
                <td className="num text-center">{i + 1}</td>
                <td>
                  <span className="num">{p.code} </span>
                  {p.name}
                  {!p.isQuotation && <span className="text-neutral-600"> (ในประกัน / ไม่คิดเงิน)</span>}
                </td>
                <td className="num text-center">{qty}</td>
                <td className="num text-right">{money(p.isQuotation ? p.unitPrice : 0)}</td>
                <td className="num text-right">{money(p.isQuotation ? qty * p.unitPrice : 0)}</td>
              </tr>
            );
          })}
          <tr className="fill">
            <td /><td /><td /><td /><td />
          </tr>
        </tbody>
      </table>
      </div>

      {/* ── return / payment + totals ── */}
      <table className="sum">
        <tbody>
          <tr>
            <td rowSpan={6} style={{ width: "58%" }}>
              <table className="kv text-[11px]">
                <tbody>
                  <tr><td className="k">การส่งคืน :</td><td>{or(j.return.type, "—")}{j.return.date ? `  วันที่ ${dmy(j.return.date)}` : ""}</td></tr>
                  <tr><td className="k">ขนส่ง / เลขพัสดุ :</td><td className="num">{[j.return.detail, j.return.tracking].filter(Boolean).join("  ·  ") || "—"}</td></tr>
                  <tr><td className="k">ชำระเงิน :</td><td>{[j.payment.type, j.payment.amount ? `${money(j.payment.amount)} บาท` : "", j.payment.no ? `(เลขที่ ${j.payment.no})` : ""].filter(Boolean).join("  ") || "—"}</td></tr>
                  {j.payment.detail && <tr><td className="k">รายละเอียด :</td><td>{j.payment.detail}</td></tr>}
                </tbody>
              </table>
            </td>
            <td className="w-[154px] text-right font-semibold">ค่าอะไหล่ / Parts :</td>
            <td className="num w-[92px] text-right">{money(j.partsCost)}</td>
          </tr>
          <tr>
            <td className="text-right font-semibold">ค่าบริการ / Service :</td>
            <td className="num text-right">{money(j.serviceCost)}</td>
          </tr>
          <tr>
            <td className="text-right font-semibold">ค่าเครื่องมือพิเศษ / Tools :</td>
            <td className="num text-right">{money(j.toolCost)}</td>
          </tr>
          <tr>
            <td className="text-right font-semibold">ค่าขนส่ง + กล่อง / Shipping :</td>
            <td className="num text-right">{money(shipping)}</td>
          </tr>
          <tr>
            <td className="text-right font-semibold">มัดจำ / Deposit :</td>
            <td className="num text-right">{j.depositCost ? `-${money(j.depositCost)}` : money(0)}</td>
          </tr>
          <tr>
            <td className="text-right font-bold">รวมทั้งสิ้น / Grand Total :</td>
            <td className="num text-right font-bold">{money(j.totalCost)}</td>
          </tr>
          <tr>
            <td className="words text-center font-semibold" colSpan={3}>({bahtText(j.totalCost)})</td>
          </tr>
        </tbody>
      </table>

      {/* ── signatures ── */}
      <table className="grid-b mt-1.5">
        <tbody>
          <tr>
            <td className="w-[58%] br sig text-center">
              <p className="text-[10.5px]">ได้ตรวจสอบและรับสินค้าคืนเรียบร้อยแล้ว</p>
              <p className="mt-3 font-semibold">ผู้รับสินค้า (ลูกค้า)</p>
              <p className="mx-auto mt-6 flex w-[240px] justify-between border-t border-black pt-0.5"><span>(</span><span>)</span></p>
              <p className="mt-2">วันที่ <span className="inline-block w-[120px] border-b border-black text-center">&nbsp;/&nbsp;&nbsp;&nbsp;&nbsp;/&nbsp;</span></p>
            </td>
            <td className="sig">
              <p className="text-center font-semibold">ในนาม<br />{COMPANY.nameTh}</p>
              <div className="mt-5 flex items-end gap-2">
                <span className="font-semibold">ผู้ส่งคืน / ช่าง :</span>
                <span className="flex-1 border-b border-black" />
              </div>
              <p className="mt-1 text-center">( {or(j.engineer, "—")} )</p>
              <p className="num mt-2 text-center text-[10px]">{contactLine}</p>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-1.5 flex items-start justify-between gap-6 text-[9.5px] text-neutral-700">
        <ol className="list-decimal pl-4">
          {RETURN_TERMS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
        <span className="shrink-0">Printing Date : {stamp()}</span>
      </div>
    </div>
  );
}
