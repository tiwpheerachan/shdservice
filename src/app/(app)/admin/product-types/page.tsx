import { MasterTable } from "@/components/shared/master-table";
import { getProductTypes } from "@/data/queries";

export const metadata = { title: "ประเภทเครื่องซ่อม" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const rows = await getProductTypes();
  return (
    <MasterTable
      config={{
        title: "ประเภทเครื่องซ่อม",
        description: "กลุ่มประเภทของสินค้าที่รับเข้าซ่อม",
        nameLabel: "ประเภทเครื่องซ่อม",
        detailLabel: "รายละเอียด",
        rows,
      }}
    />
  );
}
