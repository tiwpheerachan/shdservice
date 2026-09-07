"use client";

import * as React from "react";
import {
  Phone,
  Mail,
  MapPin,
  MessageSquare,
  Hash,
  Copy,
  Check,
  IdCard,
  Plus,
  Clock,
  User,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { useJobs } from "@/data/db";
import type { Customer } from "@/data/mock";
import { baht, cn } from "@/lib/utils";

type CallLog = { id: number; detail: string; date: string; by: string };

const CURRENT_USER = "May - Pradit";
const DONE = new Set(["ปิดงาน", "ซ่อมเสร็จ"]);

function initials(name: string) {
  const clean = name.replace(/^(คุณ|บริษัท|ห้างหุ้นส่วนจำกัด|ร้าน)\s*/u, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

function InfoRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ElementType;
  label: string;
  value?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-card text-muted-foreground ring-1 ring-inset ring-border">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-2xs text-muted-foreground">{label}</p>
        <p className={cn("break-words text-sm text-foreground", mono && "num")}>
          {value?.trim() ? value : <span className="text-muted-foreground/60">—</span>}
        </p>
      </div>
    </div>
  );
}

export function CustomerCallModal({
  open,
  onClose,
  customer,
  jobNo,
}: {
  open: boolean;
  onClose: () => void;
  customer: Customer | null;
  jobNo?: string;
}) {
  const { push } = useToast();
  const { data: JOBS } = useJobs();
  const [tab, setTab] = React.useState("history");
  const [log, setLog] = React.useState<CallLog[]>([]);
  const [text, setText] = React.useState("");
  const [copied, setCopied] = React.useState(false);

  // reset call log + draft whenever a different customer is opened
  React.useEffect(() => {
    setLog([]);
    setText("");
    setCopied(false);
    setTab("history");
  }, [customer?.code, open]);

  const history = React.useMemo(
    () => (customer ? JOBS.filter((j) => j.customer === customer.name) : []),
    [JOBS, customer]
  );
  const hist = {
    total: history.length,
    done: history.filter((j) => DONE.has(j.status)).length,
    value: history.reduce((s, j) => s + j.amount, 0),
  };

  const addLog = () => {
    const v = text.trim();
    if (!v) return;
    const now = new Date();
    const date =
      now.toISOString().slice(0, 10) +
      " " +
      now.toTimeString().slice(0, 5);
    setLog((l) => [{ id: l.length + 1, detail: v, date, by: CURRENT_USER }, ...l]);
    setText("");
    push({ kind: "success", title: "เพิ่มบันทึกการโทรแล้ว", desc: "ระบบสาธิต — ไม่บันทึกจริง" });
  };

  const copyPhone = async () => {
    if (!customer?.phone) return;
    try {
      await navigator.clipboard.writeText(customer.phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      push({ kind: "warning", title: "คัดลอกไม่สำเร็จ" });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="รายละเอียดลูกค้า & Call Log"
      description={jobNo ? `อ้างอิงงาน ${jobNo}` : undefined}
      footer={
        <Button variant="outline" size="sm" onClick={onClose}>
          ปิด
        </Button>
      }
    >
      {!customer ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          ไม่พบข้อมูลลูกค้าสำหรับงานนี้
        </p>
      ) : (
        <div className="space-y-5">
          {/* identity header */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-gradient-to-br from-primary/8 to-info/8 p-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-info text-base font-semibold uppercase text-primary-foreground shadow-sm">
              {initials(customer.name) || <User className="h-5 w-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold">{customer.name}</p>
              <p className="num mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Hash className="h-3 w-3" />
                {customer.code}
                <Badge
                  tone={customer.status === "Active" ? "success" : "neutral"}
                  dot
                  className="ml-1"
                >
                  {customer.status}
                </Badge>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a href={`tel:${customer.phone.replace(/[^0-9+]/g, "")}`}>
                <Button size="sm">
                  <Phone className="h-3.5 w-3.5" />
                  โทร
                </Button>
              </a>
              <Button size="sm" variant="outline" onClick={copyPhone}>
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? "คัดลอกแล้ว" : "คัดลอกเบอร์"}
              </Button>
            </div>
          </div>

          {/* details grid */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <InfoRow icon={Phone} label="เบอร์โทรศัพท์" value={customer.phone} mono />
            <InfoRow icon={IdCard} label="เลขบัตร / ผู้เสียภาษี" value={customer.taxId} mono />
            <InfoRow icon={Mail} label="Email" value={customer.email} />
            <InfoRow icon={MessageSquare} label="Line ID" value={customer.line} />
            <div className="sm:col-span-2">
              <InfoRow icon={MapPin} label="ที่อยู่" value={customer.address} />
            </div>
          </div>

          {/* tabs: history + call log */}
          <div>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { key: "history", label: `ประวัติงาน (${hist.total})` },
                { key: "calls", label: `Call Log (${log.length})` },
              ]}
            />
          </div>

          {tab === "history" ? (
            <div className="space-y-3">
              {/* history summary */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                  <p className="text-2xs text-muted-foreground">จำนวนงานทั้งหมด</p>
                  <p className="num text-lg font-semibold tabular-nums">{hist.total}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                  <p className="text-2xs text-muted-foreground">ปิดงาน / เสร็จ</p>
                  <p className="num text-lg font-semibold tabular-nums text-success">
                    {hist.done}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                  <p className="text-2xs text-muted-foreground">มูลค่ารวม</p>
                  <p className="num text-lg font-semibold tabular-nums text-primary">
                    {baht(hist.value)}
                  </p>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-border">
                <div className="max-h-[38vh] overflow-y-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b border-border bg-muted text-2xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 text-left">เลขที่งาน</th>
                        <th className="px-3 py-2 text-left">วันที่</th>
                        <th className="px-3 py-2 text-left">ยี่ห้อ, รุ่น</th>
                        <th className="px-3 py-2 text-left">ประเภทงาน</th>
                        <th className="px-3 py-2 text-right">มูลค่า</th>
                        <th className="px-3 py-2 text-left">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-3 py-8 text-center text-xs text-muted-foreground"
                          >
                            ลูกค้ารายนี้ยังไม่มีประวัติงานในระบบ
                          </td>
                        </tr>
                      ) : (
                        history.map((j) => (
                          <tr
                            key={j.no}
                            className="border-b border-border/70 last:border-0 hover:bg-accent/50"
                          >
                            <td className="num px-3 py-2 font-medium text-primary">
                              {j.no}
                            </td>
                            <td className="num px-3 py-2 text-xs text-muted-foreground">
                              {j.openDate.slice(0, 10)}
                            </td>
                            <td className="px-3 py-2">{j.brandModel}</td>
                            <td className="px-3 py-2 text-xs">
                              <Badge tone="primary">{j.jobType}</Badge>
                            </td>
                            <td className="num px-3 py-2 text-right tabular-nums">
                              {baht(j.amount)}
                            </td>
                            <td className="px-3 py-2">
                              <StatusBadge status={j.status} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <MessageSquare className="h-4 w-4 text-primary" />
                บันทึกการโทร (Call Log)
                {log.length > 0 && (
                  <span className="num rounded-full bg-primary/10 px-1.5 text-2xs text-primary">
                    {log.length}
                  </span>
                )}
              </div>

              <div className="flex gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addLog()}
                placeholder="พิมพ์รายละเอียดการโทร แล้วกด Enter…"
                className="h-9 flex-1 rounded-md border border-input bg-card px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button size="sm" onClick={addLog}>
                <Plus className="h-3.5 w-3.5" />
                เพิ่มรายการ
              </Button>
            </div>

            <div className="mt-3 overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
                    <th className="w-10 px-3 py-2 text-center">#</th>
                    <th className="px-3 py-2 text-left">รายละเอียด</th>
                    <th className="w-36 px-3 py-2 text-left">วันที่</th>
                    <th className="w-32 px-3 py-2 text-left">โดย</th>
                  </tr>
                </thead>
                <tbody>
                  {log.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-xs text-muted-foreground">
                        ยังไม่มีบันทึกการโทร — เพิ่มรายการแรกได้เลย
                      </td>
                    </tr>
                  ) : (
                    log.map((l, i) => (
                      <tr key={l.id} className="border-b border-border/70 last:border-0">
                        <td className="num px-3 py-2 text-center text-muted-foreground">
                          {log.length - i}
                        </td>
                        <td className="px-3 py-2">{l.detail}</td>
                        <td className="num px-3 py-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {l.date}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs">{l.by}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
