"use client";

import * as React from "react";
import { Plus, Trash2, UserRound, FileText, ShoppingCart, Wallet } from "lucide-react";
import { Section } from "./section";
import { CustomerSelect } from "./customer-select";
import { ProductPicker } from "./product-picker";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid, ReadOnly } from "@/components/ui/field";
import { Input, Select, Textarea, Radio, NumberInput } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { PAYMENT_METHODS, type Customer } from "@/data/mock";
import { useProducts, useStaff } from "@/data/db";
import { baht } from "@/lib/utils";
import { errMsg, uploadFile, fileUrl } from "@/lib/api";
import { useAccess } from "@/lib/use-access";

type Line = { id: number; code: string; name: string; qty: number; price: number; type: "SparePart" | "Service" };

/** GET /api/sale-orders/:no (subset the form uses) */
export type SaleOrderLoaded = {
  no: string;
  date: string;
  sales: string;
  createdBy: string;
  approve: string;
  approveId?: number;
  paymentType?: string;
  paymentAmount?: number;
  remark?: string;
  slip: string;
  customerDetail: { code: string; taxId: string; name: string; address: string; phone: string; line: string; email: string };
  lines: { code: string; name: string; type: "SparePart" | "Service"; qty: number; price: number }[];
};

export type SaleOrderPayload = {
  no?: string;
  customerCode: string;
  salesId?: number;
  lines: { code: string; qty: number; price: number; name: string; type: "SparePart" | "Service" }[];
  paymentType: string;
  paymentAmount: string;
  slip: string;
  remark: string;
  submit: boolean;
};

export type SaleOrderFormHandle = {
  payload: () => SaleOrderPayload;
  /** upload a slip chosen before the SO existed (new page calls this after create) */
  uploadPendingSlip: (soNo: string) => Promise<void>;
};

export const SaleOrderForm = React.forwardRef<SaleOrderFormHandle, { soNo?: string; initial?: SaleOrderLoaded | null }>(
  function SaleOrderForm({ soNo, initial }, ref) {
    const { push } = useToast();
    const { name: me } = useAccess();
    const { data: PRODUCTS } = useProducts();
    const { data: STAFF } = useStaff();
    const [lines, setLines] = React.useState<Line[]>([]);
    const [code, setCode] = React.useState("");
    const [qty, setQty] = React.useState(1);
    const [customer, setCustomer] = React.useState<Customer | null>(null);
    const [salesId, setSalesId] = React.useState<number>(0);
    const [payment, setPayment] = React.useState(PAYMENT_METHODS[0]);
    const [payAmount, setPayAmount] = React.useState("");
    const [remark, setRemark] = React.useState("");
    const [slip, setSlip] = React.useState("");
    const [pendingSlip, setPendingSlip] = React.useState<File | null>(null);
    const [submit, setSubmit] = React.useState(false);

    // สลิป → bucket oneservice/sale-orders/{no}/slip/… (path เก็บใน sale_out_hd.slip_file_name)
    const onPickSlip = async (f: File | undefined) => {
      if (!f) return;
      const no = soNo || initial?.no;
      if (!no) {
        setPendingSlip(f);
        setSlip(f.name);
        return;
      }
      try {
        const d = await uploadFile("sale-order-slip", no, f);
        setSlip(d.path);
        push({ kind: "success", title: "อัปโหลดสลิปแล้ว", desc: f.name });
      } catch (e) {
        push({ kind: "error", title: "อัปโหลดสลิปไม่สำเร็จ", desc: errMsg(e) });
      }
    };
    const [date, setDate] = React.useState("");
    const idRef = React.useRef(0);

    React.useEffect(() => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      setDate(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`);
    }, []);

    // prefill from an existing SO
    React.useEffect(() => {
      if (!initial) return;
      setLines(initial.lines.map((l) => ({ id: ++idRef.current, code: l.code, name: l.name, qty: l.qty, price: l.price, type: l.type })));
      const c = initial.customerDetail;
      setCustomer({ code: c.code, name: c.name, address: c.address, phone: c.phone, email: c.email, line: c.line, taxId: c.taxId, status: "Active" });
      setPayment(initial.paymentType || PAYMENT_METHODS[0]);
      setPayAmount(initial.paymentAmount ? String(initial.paymentAmount) : "");
      setRemark(initial.remark ?? "");
      setSlip(initial.slip);
      setSubmit((initial.approveId ?? 0) >= 2);
      setDate(initial.date);
      const s = STAFF.find((x) => x.name === initial.sales);
      if (s) setSalesId(s.id);
    }, [initial, STAFF]);

    const add = () => {
      const p = PRODUCTS.find((x) => x.sysCode === code);
      if (!p) return;
      setLines((s) => [...s, { id: ++idRef.current, code: p.sysCode, name: p.name, qty, price: p.price, type: "SparePart" }]);
      setCode("");
      setQty(1);
    };

    const total = lines.reduce((s, l) => s + l.qty * l.price, 0);


    React.useImperativeHandle(ref, () => ({
      uploadPendingSlip: async (no: string) => {
        if (!pendingSlip) return;
        try {
          await uploadFile("sale-order-slip", no, pendingSlip);
          setPendingSlip(null);
        } catch (e) {
          push({ kind: "error", title: "อัปโหลดสลิปไม่สำเร็จ", desc: errMsg(e) });
        }
      },
      payload: () => ({
        no: soNo || initial?.no || undefined,
        customerCode: customer?.code ?? "",
        salesId: salesId || undefined,
        lines: lines.map((l) => ({ code: l.code, qty: l.qty, price: l.price, name: l.name, type: l.type })),
        paymentType: payment,
        paymentAmount: payAmount,
        slip: slip.includes("/") ? slip : "",
        remark,
        submit,
      }),
    }));

    return (
      <>
        <Section title="Customer Info" icon={UserRound} description={customer ? "ข้อมูลกลางจากตารางลูกค้า (อ่านอย่างเดียว)" : "เลือก ลูกค้าเดิม เพื่อค้นหา หรือ ลูกค้าใหม่"}>
          <CustomerSelect value={customer} onChange={setCustomer} />
        </Section>

        <Section title="Sale Order Info" icon={FileText}>
          <FieldGrid>
            <Field label="เลขใบสั่งขาย">
              <ReadOnly>
                <span className="num">{soNo ?? initial?.no ?? "Generate Auto"}</span>
              </ReadOnly>
            </Field>
            <Field label="วันที่สร้าง">
              <ReadOnly><span className="num">{date}</span></ReadOnly>
            </Field>
            <Field label="สร้างโดย">
              <ReadOnly>{initial?.createdBy || me || "—"}</ReadOnly>
            </Field>
            <Field label="พนักงานขาย" required>
              <Select value={salesId ? String(salesId) : ""} onChange={(e) => setSalesId(Number(e.target.value) || 0)}>
                <option value="">- - ยังไม่ระบุ - -</option>
                {STAFF.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldGrid>
        </Section>

        <Section
          title="รายการสินค้า"
          icon={ShoppingCart}
          bodyClassName="p-0"
        >
          <div className="flex flex-col gap-2 border-b border-border p-4 sm:flex-row sm:items-end">
            <Field label="รหัสสินค้า หรือ ชื่อสินค้า" className="flex-1">
              <ProductPicker id="so-product" products={PRODUCTS} value={code} clearable onPick={(p) => setCode(p?.code ?? "")} placeholder="ค้นหา ชื่อสินค้า / รหัส / เลข part / ยี่ห้อ…" />
            </Field>
            <Field label="จำนวน" className="sm:w-28">
              <NumberInput
                min={1}
                placeholder="1"
                value={qty}
                onChange={(n) => setQty(n)}
              />
            </Field>
            <Field label="หน่วยนับ" className="sm:w-28">
              <Input readOnly value="Pcs." />
            </Field>
            <Button size="md" onClick={add} disabled={!code}>
              <Plus className="h-3.5 w-3.5" />
              เพิ่มรายการ
            </Button>
          </div>

          <div className="table-scroll rounded-none">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
                  <th className="w-10 px-3 py-2 text-left">#</th>
                  <th className="w-28 px-3 py-2 text-left">Item Code</th>
                  <th className="px-3 py-2 text-left">รายละเอียดสินค้า</th>
                  <th className="w-20 px-3 py-2 text-right">จำนวน</th>
                  <th className="w-28 px-3 py-2 text-right">ราคาขาย/หน่วย</th>
                  <th className="w-28 px-3 py-2 text-right">เป็นเงิน</th>
                  <th className="w-16 px-3 py-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-xs text-muted-foreground">
                      ยังไม่มีรายการสินค้า
                    </td>
                  </tr>
                ) : (
                  lines.map((l, i) => (
                    <tr key={l.id} className="border-b border-border/70 last:border-0">
                      <td className="num px-3 py-2 text-muted-foreground">{i + 1}</td>
                      <td className="num px-3 py-2 font-medium">{l.code}</td>
                      <td className="px-3 py-2">
                        <span className="line-clamp-2 max-w-[320px]">{l.name}</span>
                      </td>
                      <td className="px-3 py-2">
                        <NumberInput
                          min={1}
                          value={l.qty}
                          onChange={(n) => setLines((s) => s.map((x) => (x.id === l.id ? { ...x, qty: Math.max(1, n) } : x)))}
                          className="ml-auto h-8 w-16 text-right text-xs"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <NumberInput
                          step="0.01"
                          value={l.price}
                          onChange={(n) => setLines((s) => s.map((x) => (x.id === l.id ? { ...x, price: n } : x)))}
                          className="ml-auto h-8 w-24 text-right text-xs"
                        />
                      </td>
                      <td className="num px-3 py-2 text-right font-medium">
                        {baht(l.qty * l.price)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => setLines((s) => s.filter((x) => x.id !== l.id))}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
                          aria-label="ลบ"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="bg-muted/50 font-semibold">
                  <td colSpan={5} className="px-3 py-2 text-right">
                    รวมเป็นเงินทั้งสิ้น
                  </td>
                  <td className="num px-3 py-2 text-right text-primary">{baht(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Section>

        <Section title="การชำระเงินและเอกสาร" icon={Wallet}>
          <FieldGrid>
            <Field label="วิธีการชำระเงิน" required className="lg:col-span-2">
              <div className="flex flex-wrap gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
                {PAYMENT_METHODS.map((p) => (
                  <label key={p} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Radio name="payment" checked={payment === p} onChange={() => setPayment(p)} />
                    {p}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="จำนวนเงินที่ชำระ (บาท)">
              <Input
                type="number"
                step="0.01"
                min={0}
                inputMode="decimal"
                placeholder={total ? total.toFixed(2) : "0.00"}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                className="num text-right"
              />
            </Field>
            <Field label="สลิปหลักฐานการโอน" hint={slip.includes("/") ? undefined : slip ? `จะอัปโหลดหลังบันทึก: ${slip}` : undefined}>
              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  className="h-9 py-1.5 text-xs"
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  onChange={(e) => onPickSlip(e.target.files?.[0])}
                />
                {slip.includes("/") && (
                  <a href={fileUrl(slip)} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-primary hover:underline">
                    ดูสลิป
                  </a>
                )}
              </div>
            </Field>
            <Field label="หมายเหตุ" wide>
              <Textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
            </Field>
            <Field label="Action" required wide>
              <div className="flex flex-wrap gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
                {[
                  { k: false, l: "กำลังดำเนินการจัดทำ (In Progress)" },
                  { k: true, l: "Send To Approve" },
                ].map((a) => (
                  <label key={a.l} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Radio name="so-action" checked={submit === a.k} onChange={() => setSubmit(a.k)} />
                    {a.l}
                  </label>
                ))}
              </div>
            </Field>
          </FieldGrid>
        </Section>
      </>
    );
  }
);
