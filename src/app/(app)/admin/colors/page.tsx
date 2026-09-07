import { MasterTable } from "@/components/shared/master-table";
import { getColors } from "@/data/queries";

export const metadata = { title: "สีสินค้า" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const rows = await getColors();
  return (
    <MasterTable
      config={{
        title: "สีสินค้า",
        description: "รหัสสีมาตรฐานสำหรับระบุสีของเครื่องที่รับซ่อม",
        nameLabel: "ชื่อสี",
        detailLabel: "รายละเอียด",
        rows,
      }}
    />
  );
}
