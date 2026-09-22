"use client";

import * as React from "react";
import { Printer, ChevronDown, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/shadcn/popover";
import { useToast } from "@/components/ui/toast";
import { useDocumentProfiles } from "@/data/db";
import { postJson, errMsg } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { DocumentKind } from "@/server/services/document-profiles";

/**
 * "พิมพ์…" button that also lets the user pick which company/brand the document
 * is printed under. Picking a different brand saves it on the document first
 * (POST /api/documents/profile — audited), then opens the print page, so a
 * reprint later comes out the same. With a single active profile it is a plain
 * print button.
 */
export function PrintButton({
  label,
  href,
  kind,
  no,
  profileId,
  onProfileChange,
  disabled,
  title,
  size = "md",
  icon = true,
}: {
  label: string;
  /** print page, e.g. /print/job/J2612165/return */
  href: string;
  kind: DocumentKind;
  no: string;
  /** the document's current document_profile_id (0 / undefined = SHD) */
  profileId?: number;
  onProfileChange?: (id: number) => void;
  disabled?: boolean;
  title?: string;
  size?: "sm" | "md";
  icon?: boolean;
}) {
  const { push } = useToast();
  const { data: profiles } = useDocumentProfiles();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const currentId = profileId || profiles.find((p) => p.isDefault)?.id || profiles[0]?.id || 0;

  const print = () => window.open(href, "_blank");

  const pick = async (id: number) => {
    setOpen(false);
    if (id === currentId) return print();
    setBusy(true);
    try {
      const d = await postJson<{ profile: { code: string; nameTh: string } }>("/api/documents/profile", { kind, no, profileId: id });
      onProfileChange?.(id);
      push({ kind: "success", title: "เปลี่ยนออกเอกสารในนามแล้ว", desc: `${no} → ${d.profile.code} — ${d.profile.nameTh}` });
      print();
    } catch (e) {
      push({ kind: "error", title: "เปลี่ยนออกเอกสารในนามไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  // one brand → nothing to choose
  if (profiles.length <= 1) {
    return (
      <Button variant="outline" size={size} type="button" disabled={disabled} title={title} onClick={print}>
        {icon && <Printer className="h-3.5 w-3.5" />}
        {label}
      </Button>
    );
  }

  return (
    <div className="inline-flex">
      <Button
        variant="outline"
        size={size}
        type="button"
        disabled={disabled || busy}
        title={title}
        onClick={print}
        className="rounded-r-none border-r-0"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon && <Printer className="h-3.5 w-3.5" />}
        {label}
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size={size} type="button" disabled={disabled || busy} className="rounded-l-none px-2" aria-label="เลือกบริษัทที่ออกเอกสาร" title="พิมพ์ในนาม…">
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-1.5">
          <p className="px-2 pb-1.5 pt-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">พิมพ์ในนาม</p>
          {profiles.map((p) => {
            const on = p.id === currentId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => void pick(p.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                  on && "bg-primary-soft text-primary"
                )}
              >
                <span className="w-4 shrink-0">{on && <Check className="h-4 w-4" />}</span>
                <span className="min-w-0">
                  <span className="font-medium">{p.code}</span>
                  <span className="block truncate text-xs text-muted-foreground">{p.nameTh}</span>
                </span>
              </button>
            );
          })}
          <p className="px-2 pb-1 pt-1.5 text-2xs text-muted-foreground">เลือกแบรนด์อื่น = บันทึกลงเอกสารนี้แล้วพิมพ์ (เลขที่เอกสารไม่เปลี่ยน)</p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
