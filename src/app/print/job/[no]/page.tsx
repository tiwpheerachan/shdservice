import { notFound } from "next/navigation";
import { getJob } from "@/server/services/jobs";
import { PrintFrame, Box, KV, Signatures, money } from "@/components/print/print-frame";
import { REPAIR_TERMS } from "@/lib/company";

export const dynamic = "force-dynamic";

/** ใบรับงานซ่อม — printed when a job is opened; the customer keeps a copy. */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const j = await getJob(decodeURIComponent(no).toUpperCase());
  if (!j) notFound();
  const c = j.customer;
  return (
    <PrintFrame
      title="ใบรับงานซ่อม"
      docNo={j.no}
      meta={[
        { label: "วันที่รับงาน", value: j.createDate },
        { label: "ผู้รับงาน", value: j.createByName },
        { label: "สถานะ", value: j.status },
      ]}
    >
      <Box title="ข้อมูลลูกค้า">
        <KV
          items={[
            { k: "รหัสลูกค้า", v: c?.code },
            { k: "ชื่อลูกค้า", v: c?.name },
            { k: "โทรศัพท์", v: c?.phone },
            { k: "Line ID", v: c?.line },
            { k: "ที่อยู่", v: c?.address },
            { k: "อีเมล", v: c?.email },
          ]}
        />
      </Box>

      <Box title="ข้อมูลสินค้า">
        <KV
          cols={3}
          items={[
            { k: "ยี่ห้อ / รุ่น", v: [j.brand, j.modelName].filter(Boolean).join(" ") },
            { k: "รุ่นย่อย", v: j.modelDetail },
            { k: "ประเภทสินค้า", v: j.productType },
            { k: "Serial No.", v: j.serial },
            { k: "IMEI", v: j.imei },
            { k: "สี", v: j.color },
            { k: "การรับประกัน", v: j.warranty ? `${j.warranty === "IN" ? "ในประกัน" : "นอกประกัน"}${j.expireDate ? ` (หมดอายุ ${j.expireDate})` : ""}` : "" },
            { k: "ซื้อจากช่องทาง", v: [j.channel, j.shopName].filter(Boolean).join(" · ") },
            { k: "เลขคำสั่งซื้อ", v: j.so },
            { k: "วันที่ซื้อ", v: j.saleOrderDate },
            { k: "รับเข้าโดย", v: j.receptionType },
            { k: "เลขพัสดุ / ขนส่ง", v: [j.receptionTrackingNo, j.receptionShipper].filter(Boolean).join(" · ") },
          ]}
        />
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
          <p><span className="text-neutral-500">อุปกรณ์ที่นำส่ง:</span> {j.equipment || "—"}</p>
          <p><span className="text-neutral-500">จุดตำหนิ / สภาพภายนอก:</span> {j.fault || "—"}</p>
        </div>
      </Box>

      <Box title="อาการเสียที่แจ้ง">
        <p>
          <span className="text-neutral-500">อาการเสียมาตรฐาน:</span> {j.symptoms.length ? j.symptoms.join(", ") : "—"}
        </p>
        <p>
          <span className="text-neutral-500">อาการเสียอื่น ๆ:</span> {j.symptomOther || "—"}
        </p>
        <p>
          <span className="text-neutral-500">หมายเหตุ:</span> {j.remark || "—"}
        </p>
      </Box>

      <Box title="ประเภทงาน / ค่าใช้จ่ายเบื้องต้น">
        <KV
          cols={3}
          items={[
            { k: "ประเภทงานหลัก", v: j.jobType },
            { k: "งานย่อย", v: j.jobTypeDetail },
            { k: "ช่างผู้รับผิดชอบ", v: j.engineer },
            { k: "ค่าประเมินซ่อม", v: j.estimateCost ? `${money(j.estimateCost)} บาท` : "" },
            { k: "ค่ามัดจำ", v: j.depositCost ? `${money(j.depositCost)} บาท` : "" },
            { k: "กำหนดเสร็จโดยประมาณ", v: j.dueDate },
          ]}
        />
      </Box>

      <Box title="เงื่อนไขการรับซ่อม">
        <ol className="list-decimal space-y-0.5 pl-5 text-[11px]">
          {REPAIR_TERMS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
      </Box>

      <Signatures left="ลงชื่อลูกค้า" right="ลงชื่อผู้รับงาน" />
    </PrintFrame>
  );
}
