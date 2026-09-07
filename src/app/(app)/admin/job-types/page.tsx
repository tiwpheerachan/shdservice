import { MasterTable } from "@/components/shared/master-table";
import { getJobTypes } from "@/data/queries";

export const metadata = { title: "ประเภทงานซ่อม" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const rows = await getJobTypes();
  return (
    <MasterTable
      config={{
        title: "ประเภทงานซ่อม",
        description: "ประเภทงานหลักที่ใช้ตอนเปิดงานบริการ",
        nameLabel: "ประเภทงานซ่อม",
        detailLabel: "รายละเอียด",
        rows,
      }}
    />
  );
}
