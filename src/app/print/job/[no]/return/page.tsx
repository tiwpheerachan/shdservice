import { notFound } from "next/navigation";
import { getJob } from "@/server/services/jobs";
import { PrintFrame, Box, KV, Signatures, money } from "@/components/print/print-frame";

export const dynamic = "force-dynamic";

/** ใบส่งคืนสินค้า / สรุปค่าซ่อม — printed from the close-job screen. */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const j = await getJob(decodeURIComponent(no).toUpperCase());
  if (!j) notFound();
  const c = j.customer;
  const parts = j.parts.filter((p) => p.statusId === 3 || p.granted > 0);
  return (
    <PrintFrame
      title="ใบส่งคืนสินค้า"
      docNo={j.no}
      meta={[
        { label: "วันที่เปิดงาน", value: j.createDate },
        { label: "วันที่ซ่อมเสร็จ", value: j.repairedDate },
        { label: "วันที่ปิดงาน", value: j.closedDate },
        { label: "สถานะ", value: j.status },
      ]}
    >
      <div className="grid grid-cols-2 gap-4">
        <Box title="ลูกค้า">
          <KV
            items={[
              { k: "รหัส", v: c?.code },
              { k: "ชื่อ", v: c?.name },
              { k: "โทรศัพท์", v: c?.phone },
              { k: "ที่อยู่", v: c?.address },
            ]}
          />
        </Box>
        <Box title="สินค้า">
          <KV
            items={[
              { k: "ยี่ห้อ / รุ่น", v: [j.brand, j.modelName].filter(Boolean).join(" ") },
              { k: "Serial / IMEI", v: [j.serial, j.imei].filter(Boolean).join(" / ") },
              { k: "การรับประกัน", v: j.warranty === "IN" ? "ในประกัน" : j.warranty === "OUT" ? "นอกประกัน" : j.warranty },
              { k: "ประเภทงาน", v: j.jobType },
            ]}
          />
        </Box>
      </div>

      <Box title="ผลการซ่อม">
        <KV
          items={[
            { k: "อาการที่แจ้ง", v: j.symptoms.join(", ") || j.symptomOther },
            { k: "อาการที่ตรวจพบ", v: j.engineerSymptom },
            { k: "วิธีการซ่อม", v: j.repairDetail },
            { k: "ช่างผู้รับผิดชอบ", v: j.engineer },
            { k: "หมายเหตุช่าง", v: j.engineerRemark },
            { k: "ใบเสนอราคาที่ลูกค้าตกลง", v: j.quotationNo },
          ]}
        />
      </Box>

      <Box title="อะไหล่ที่ใช้">
        <table>
          <thead>
            <tr>
              <th className="w-8">#</th>
              <th className="w-24">รหัส</th>
              <th>รายการ</th>
              <th className="w-16 text-right">จำนวน</th>
              <th className="w-24 text-right">ราคา/หน่วย</th>
              <th className="w-24 text-right">รวม</th>
            </tr>
          </thead>
          <tbody>
            {parts.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-neutral-500">— ไม่มีการเปลี่ยนอะไหล่ —</td>
              </tr>
            ) : (
              parts.map((p, i) => (
                <tr key={p.logId}>
                  <td className="num">{i + 1}</td>
                  <td className="num">{p.code}</td>
                  <td>{p.name}</td>
                  <td className="num text-right">{p.granted || p.requested}</td>
                  <td className="num text-right">{p.isQuotation ? money(p.unitPrice) : "ไม่คิดเงิน"}</td>
                  <td className="num text-right">{p.isQuotation ? money((p.granted || p.requested) * p.unitPrice) : "0.00"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Box>

      <div className="grid grid-cols-2 gap-4">
        <Box title="สรุปค่าใช้จ่าย">
          <table>
            <tbody>
              {[
                ["ค่าอะไหล่", j.partsCost],
                ["ค่าบริการการซ่อม", j.serviceCost],
                ["ค่าเครื่องมือพิเศษ", j.toolCost],
                ["ค่าขนส่ง", j.deliveryCost],
                ["ค่ากล่องพัสดุ", j.boxCost],
              ].map(([k, v]) => (
                <tr key={String(k)}>
                  <td>{k}</td>
                  <td className="num w-32 text-right">{money(Number(v))}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td>รวมเป็นเงินสุทธิ</td>
                <td className="num text-right">{money(j.totalCost)}</td>
              </tr>
            </tbody>
          </table>
        </Box>
        <Box title="การชำระเงินและการส่งคืน">
          <KV
            items={[
              { k: "วิธีชำระเงิน", v: j.payment.type },
              { k: "ยอดชำระ", v: j.payment.amount ? `${money(j.payment.amount)} บาท` : "" },
              { k: "เลขที่ใบเสร็จ", v: j.payment.no },
              { k: "รายละเอียด", v: j.payment.detail },
              { k: "วิธีส่งคืน", v: j.return.type },
              { k: "วันที่ส่งคืน", v: j.return.date },
              { k: "เลขพัสดุ", v: j.return.tracking },
              { k: "รายละเอียดการส่ง", v: j.return.detail },
            ]}
          />
        </Box>
      </div>

      <Signatures left="ลงชื่อผู้รับสินค้า" right="ลงชื่อผู้ส่งมอบ" />
    </PrintFrame>
  );
}
