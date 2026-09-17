"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { ExternalLink, Loader2, Plus, RefreshCw, Search, UserRound, UserRoundPlus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input, Textarea, Radio } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { type Customer } from "@/data/mock";
import { api, postJson, errMsg, qs, ApiError } from "@/lib/api";
import { useAccess } from "@/lib/use-access";
import { cn } from "@/lib/utils";
import { CustomerFields, ConflictNotice, EMPTY_CUSTOMER, type CustomerFormValues, type CustomerConflict } from "./customer-form";

/**
 * Customer block used by job / quotation / sale-order forms.
 *
 *   ลูกค้าเดิม  → search-as-you-type (code / name / phone / tax id / email) → pick →
 *                 read-only details + link to the customers page for edits
 *   ลูกค้าใหม่  → inline CustomerFields → "บันทึกลูกค้าใหม่" (POST /api/customers) →
 *                 auto-selected; the server refuses duplicates (phone / email / tax id)
 *                 and the conflicts are shown with a "ใช้ลูกค้ารายนี้" shortcut
 */
type Mode = "existing" | "new";

export function CustomerSelect({
  value,
  onChange,
  readOnly = false,
  allowNew = true,
}: {
  value: Customer | null;
  onChange: (c: Customer | null) => void;
  readOnly?: boolean;
  allowNew?: boolean;
}) {
  const { push } = useToast();
  const { can } = useAccess();
  const canAdd = allowNew && can("Customer", "add");
  const canEdit = can("Customer", "edit");
  const [mode, setMode] = React.useState<Mode>("existing");
  const [form, setForm] = React.useState<CustomerFormValues>(EMPTY_CUSTOMER);
  const [saving, setSaving] = React.useState(false);
  const [conflicts, setConflicts] = React.useState<CustomerConflict[] | null>(null);

  const pickByCode = async (code: string) => {
    try {
      const d = await api<{ rows: Customer[] }>(`/api/customers/lookup${qs({ q: code })}`);
      const hit = d.rows.find((c) => c.code === code) ?? d.rows[0] ?? null;
      if (hit) { onChange(hit); setMode("existing"); setConflicts(null); }
      return hit;
    } catch (e) {
      push({ kind: "error", title: "โหลดข้อมูลลูกค้าไม่สำเร็จ", desc: errMsg(e) });
      return null;
    }
  };

  const startNew = (prefill: string) => {
    const digits = prefill.replace(/\D/g, "");
    setForm({ ...EMPTY_CUSTOMER, phone: digits.length >= 6 ? digits : "", name: digits.length >= 6 ? "" : prefill.trim() });
    setConflicts(null);
    setMode("new");
  };

  const saveNew = async () => {
    if (!form.name.trim()) return push({ kind: "error", title: "กรอกไม่ครบ", desc: "ต้องระบุชื่อลูกค้า" });
    if (!form.phone.trim()) return push({ kind: "error", title: "กรอกไม่ครบ", desc: "ต้องระบุเบอร์โทรศัพท์" });
    setSaving(true);
    setConflicts(null);
    try {
      const d = await postJson<{ row: Customer }>("/api/customers", { ...form, code: undefined });
      push({ kind: "success", title: "บันทึกลูกค้าใหม่แล้ว", desc: `${d.row.code} · ${d.row.name}` });
      onChange(d.row);
      setMode("existing");
    } catch (e) {
      const details = e instanceof ApiError ? (e.details as { conflicts?: CustomerConflict[] } | undefined) : undefined;
      if (details?.conflicts?.length) setConflicts(details.conflicts);
      push({ kind: "error", title: "สร้างลูกค้าไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  /* ---------- selected: read-only details ---------- */
  if (value) {
    const c = value;
    return (
      <div className="space-y-3">
        <FieldGrid>
          <Field label="รหัสลูกค้า" required>
            <Input readOnly value={c.code} className="num" />
          </Field>
          <Field label="เลขผู้เสียภาษี / เลขบัตรประชาชน">
            <Input readOnly value={c.taxId ?? ""} placeholder="—" className="num" />
          </Field>
          <Field label="ชื่อลูกค้า" required className="lg:col-span-2">
            <Input readOnly value={c.name} />
          </Field>
          <Field label="ที่อยู่ลูกค้า" wide>
            <Textarea readOnly rows={2} value={c.address ?? ""} placeholder="—" />
          </Field>
          <Field label="เบอร์โทรศัพท์" required>
            <Input readOnly value={c.phone ?? ""} placeholder="—" className="num" />
          </Field>
          <Field label="Line ID">
            <Input readOnly value={c.line ?? ""} placeholder="—" />
          </Field>
          <Field label="Email" className="lg:col-span-2">
            <Input readOnly value={c.email ?? ""} placeholder="—" />
          </Field>
        </FieldGrid>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <span>ข้อมูลลูกค้าเป็นข้อมูลกลาง แก้ไขได้ที่หน้า ข้อมูลลูกค้า</span>
            {canEdit && (
              <a href={`/customers?edit=${encodeURIComponent(c.code)}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                แก้ไข {c.code} <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <button type="button" onClick={() => void pickByCode(c.code)} className="inline-flex items-center gap-1 hover:text-foreground">
              <RefreshCw className="h-3 w-3" /> โหลดข้อมูลใหม่
            </button>
            <button type="button" onClick={() => onChange(null)} className="inline-flex items-center gap-1 hover:text-foreground">
              <Search className="h-3 w-3" /> ค้นหาลูกค้ารายอื่น
            </button>
          </div>
        )}
      </div>
    );
  }

  if (readOnly) return <p className="text-sm text-muted-foreground">—</p>;

  /* ---------- nothing selected: choose เดิม / ใหม่ ---------- */
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-muted/40 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">ประเภทลูกค้า</span>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Radio name="customer-mode" checked={mode === "existing"} onChange={() => setMode("existing")} />
          ลูกค้าเดิม <span className="text-xs text-muted-foreground">— เคยมีข้อมูลในระบบ</span>
        </label>
        <label className={cn("flex items-center gap-2 text-sm", canAdd ? "cursor-pointer" : "cursor-not-allowed opacity-50")}>
          <Radio name="customer-mode" checked={mode === "new"} disabled={!canAdd} onChange={() => startNew("")} />
          ลูกค้าใหม่ <span className="text-xs text-muted-foreground">— ยังไม่เคยมีข้อมูล{!canAdd ? " (ต้องมีสิทธิ์เพิ่มลูกค้า)" : ""}</span>
        </label>
      </div>

      {mode === "existing" ? (
        <CustomerSearch onPick={(c) => onChange(c)} onNew={canAdd ? startNew : undefined} />
      ) : (
        <div className="space-y-4 rounded-lg border border-primary/30 bg-primary-soft/30 p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <UserRoundPlus className="h-4 w-4 text-primary" /> เพิ่มลูกค้าใหม่ — รหัสลูกค้าจะถูกสร้างอัตโนมัติ · เบอร์โทร / อีเมล / เลขบัตร ต้องไม่ซ้ำกับลูกค้าเดิม
          </p>
          <CustomerFields form={form} setForm={setForm} editing={null} showStatus={false} />
          {conflicts && <ConflictNotice conflicts={conflicts} onPick={(code) => void pickByCode(code)} />}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setMode("existing")}>
              ยกเลิก
            </Button>
            <Button size="sm" onClick={saveNew} disabled={saving} loading={saving}>
              <Plus className="h-3.5 w-3.5" />
              บันทึกลูกค้าใหม่
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- search-as-you-type (cmdk) ---------- */
function CustomerSearch({ onPick, onNew }: { onPick: (c: Customer) => void; onNew?: (prefill: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [rows, setRows] = React.useState<Customer[]>([]);
  const [loading, setLoading] = React.useState(false);
  const seq = React.useRef(0);

  // debounced server lookup (code / name / phone / tax id / email), max 10 rows
  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows([]); return; }
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      api<{ rows: Customer[] }>(`/api/customers/lookup${qs({ q: term, limit: 10 })}`)
        .then((d) => { if (my === seq.current) setRows(d.rows.slice(0, 10)); })
        .catch(() => { if (my === seq.current) setRows([]); })
        .finally(() => { if (my === seq.current) setLoading(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  // typing a full customer code (C43601) selects it without an extra click
  React.useEffect(() => {
    const term = q.trim().toUpperCase();
    if (/^C\d{5}$/.test(term)) {
      const hit = rows.find((r) => r.code === term);
      if (hit) { onPick(hit); setOpen(false); setQ(""); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const pick = (c: Customer) => { onPick(c); setOpen(false); setQ(""); };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-left text-sm text-muted-foreground transition-[border-color,box-shadow] focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20 sm:max-w-xl"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 truncate">พิมพ์ รหัส / ชื่อ / เบอร์โทร / เลขบัตร / อีเมล ลูกค้า…</span>
          <UserRound className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[320px] p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <CommandPrimitive shouldFilter={false} loop className="flex w-full flex-col overflow-hidden rounded-md bg-card text-foreground">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input
              autoFocus
              value={q}
              onValueChange={setQ}
              placeholder="พิมพ์อย่างน้อย 2 ตัวอักษร…"
              className="h-10 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
            />
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : q && (
              <button type="button" onClick={() => setQ("")} className="text-muted-foreground hover:text-foreground" aria-label="ล้าง">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <CommandPrimitive.List className="max-h-72 overflow-y-auto p-1.5">
            {q.trim().length < 2 && <p className="px-3 py-5 text-center text-xs text-muted-foreground">พิมพ์รหัส ชื่อ เบอร์โทร เลขบัตร หรืออีเมล อย่างน้อย 2 ตัวอักษร</p>}
            {q.trim().length >= 2 && !loading && rows.length === 0 && (
              <p className="px-3 py-5 text-center text-sm text-muted-foreground">ไม่พบลูกค้าที่ตรงกับ "{q.trim()}"</p>
            )}
            {rows.map((c) => (
              <CommandPrimitive.Item
                key={c.code}
                value={c.code}
                onSelect={() => pick(c)}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
              >
                <span className="num w-16 shrink-0 font-medium">{c.code}</span>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="num shrink-0 text-xs text-muted-foreground">{c.phone}</span>
                {c.status === "Inactive" && <Badge tone="neutral">Inactive</Badge>}
              </CommandPrimitive.Item>
            ))}
          </CommandPrimitive.List>
          {onNew && (
            <div className="border-t border-border p-1.5">
              <CommandPrimitive.Item
                value="__new__"
                onSelect={() => { setOpen(false); onNew(q); }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-primary outline-hidden select-none data-[selected=true]:bg-primary-soft"
              >
                <Plus className="h-4 w-4" /> ไม่ใช่รายเหล่านี้? เพิ่มลูกค้าใหม่{q.trim() ? ` (เติม "${q.trim()}" ให้)` : ""}
              </CommandPrimitive.Item>
            </div>
          )}
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  );
}
