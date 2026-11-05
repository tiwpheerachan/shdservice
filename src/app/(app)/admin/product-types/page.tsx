import { MasterTable } from '@/components/shared/master-table';
import { MASTER_NAME_LABEL } from '@/lib/validation/admin';
import { getProductTypes } from '@/data/queries';

export const metadata = { title: 'ประเภทเครื่องซ่อม' };
export const dynamic = 'force-dynamic';

export default async function Page() {
  const rows = await getProductTypes();
  return (
    <MasterTable
      config={{
        kind: 'product_types',
        title: 'ประเภทเครื่องซ่อม',
        description: 'กลุ่มประเภทของสินค้าที่รับเข้าซ่อม',
        nameLabel: MASTER_NAME_LABEL.product_types,
        detailLabel: 'รายละเอียด',
        rows,
      }}
    />
  );
}
