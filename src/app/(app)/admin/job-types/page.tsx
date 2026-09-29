import { MasterTable } from "@/components/shared/master-table";
import { getJobTypes } from "@/data/queries";

export const metadata = { title: "ประเภทงานซ่อม" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const rows = await getJobTypes();
  return (
    <MasterTable
      config={{
        kind: "job_types",
        title: "ประเภทงานซ่อม",
        description: "ประเภทงานหลักที่ใช้ตอนเปิดงานบริการ",
        nameLabel: "ประเภทงานซ่อม",
        detailLabel: "รายละเอียด",
        daysLabel: "SLA (วัน)",
        daysHint: "เป้าหมายวันซ่อมเสร็จนับจากวันเปิดงาน — ใช้เป็นวันกำหนดส่งของงานที่ยังไม่มีผู้กำหนดวัน (กระดิ่งเตือน / หน้าติดตามของลูกค้า)",
        rows,
      }}
    />
  );
}
