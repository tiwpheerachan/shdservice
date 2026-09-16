import { notFound } from "next/navigation";
import { getSaleOrder } from "@/server/services/sale-orders";
import { PrintFrame, Box, KV, Signatures, money } from "@/components/print/print-frame";

export const dynamic = "force-dynamic";

/** ใบสั่งขาย */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const o = await getSaleOrder(decodeURIComponent(no).toUpperCase());
  if (!o) notFound();
  const c = o.customerDetail;
  return (
    <PrintFrame
      title="ใบสั่งขาย"
      docNo={o.no}
      meta={[
        { label: "วันที่", value: o.date },
        { label: "พนักงานขาย", value: o.sales },
        { label: "สถานะอนุมัติ", value: o.approve },
      ]}
    >
      <Box title="ลูกค้า">
        <KV
          cols={3}
          items={[
            { k: "รหัสลูกค้า", v: c.code },
            { k: "ชื่อ", v: c.name },
            { k: "โทรศัพท์", v: c.phone },
            { k: "ที่อยู่", v: c.address },
            { k: "เลขผู้เสียภาษี", v: c.taxId },
            { k: "อีเมล", v: c.email },
          ]}
        />
      </Box>

      <Box title="รายการสินค้า">
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
            {o.lines.map((l, i) => (
              <tr key={l.id ?? i}>
                <td className="num">{i + 1}</td>
                <td className="num">{l.code}</td>
                <td>{l.name}</td>
                <td className="num text-right">{l.qty}</td>
                <td>{l.type === "Service" ? "งาน" : l.unit}</td>
                <td className="num text-right">{money(l.price)}</td>
                <td className="num text-right">{money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ml-auto mt-2 w-72">
          <table>
            <tbody>
              <tr><td>รวมเป็นเงิน</td><td className="num w-28 text-right">{money(o.totalBase)}</td></tr>
              {o.fee ? <tr><td>ค่าธรรมเนียม</td><td className="num text-right">{money(o.fee)}</td></tr> : null}
              <tr className="font-semibold"><td>จำนวนเงินรวมทั้งสิ้น</td><td className="num text-right">{money(o.amount)}</td></tr>
            </tbody>
          </table>
        </div>
      </Box>

      <Box title="การชำระเงิน / การจัดส่ง">
        <KV
          cols={3}
          items={[
            { k: "วิธีชำระเงิน", v: o.paymentType },
            { k: "ยอดชำระ", v: o.paymentAmount ? `${money(o.paymentAmount)} บาท` : "" },
            { k: "อนุมัติโดย", v: [o.approvedBy, o.approveDate].filter(Boolean).join(" · ") },
            { k: "เอกสารจ่ายสต๊อก", v: o.stockDoc },
            { k: "เลขพัสดุ", v: o.tracking },
            { k: "วันที่จัดส่ง", v: o.deliveryDate },
            { k: "หมายเหตุ", v: o.remark },
          ]}
        />
      </Box>

      <Signatures left="ผู้รับสินค้า" right="ผู้จัดส่ง / ผู้ขาย" />
    </PrintFrame>
  );
}
