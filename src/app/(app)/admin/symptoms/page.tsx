import { MasterTable } from "@/components/shared/master-table";
import { getSymptoms } from "@/data/queries";

export const metadata = { title: "อาการเสีย มาตรฐาน" };
export const dynamic = "force-dynamic";

// กลุ่มอาการเสีย: ใช้ค่าที่มีอยู่ใน DB (symptom_group_name) — เพิ่มค่าใหม่ได้ที่นี่
const GROUPS: string[] = [];

export default async function Page() {
  const rows = await getSymptoms();
  return (
    <MasterTable
      config={{
        kind: "symptoms",
        title: "อาการเสีย มาตรฐาน",
        description: "รายการอาการเสียมาตรฐานสำหรับเลือกตอนเปิดงานและบันทึกงานซ่อม",
        nameLabel: "อาการเสีย",
        detailLabel: "รายละเอียด",
        extraLabel: "กลุ่มอาการเสีย",
        extraOptions: GROUPS,
        rows,
      }}
    />
  );
}
