"use client";

import * as React from "react";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useDocumentProfiles } from "@/data/db";
import { postJson, errMsg } from "@/lib/api";
import type { DocumentKind } from "@/server/services/document-profiles";

/**
 * "ออกเอกสารในนาม" — which company/brand a job, quotation or sale order is
 * printed under (letterhead only; the document number is never affected).
 *  - new document: just form state, saved with the document
 *  - existing document (`doc` given): changing it saves immediately through
 *    POST /api/documents/profile (audited), so the print pages pick it up
 */
export function ProfileSelect({
  value,
  onChange,
  doc,
  className,
}: {
  /** document_profile.id; 0 / undefined = default profile */
  value?: number;
  onChange: (id: number) => void;
  /** the document this belongs to once it has a number — enables save-on-change */
  doc?: { kind: DocumentKind; no: string };
  className?: string;
}) {
  const { push } = useToast();
  const { data: profiles } = useDocumentProfiles();
  const [busy, setBusy] = React.useState(false);
  const def = profiles.find((p) => p.isDefault) ?? profiles[0];

  // pre-pick the default once the list arrives so the saved value is always explicit
  React.useEffect(() => {
    if (!doc && !value && def) onChange(def.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def?.id, !!doc]);

  // a single profile = nothing to choose; keep the form unchanged
  if (profiles.length <= 1) return null;

  const change = async (id: number) => {
    if (!doc) return onChange(id);
    setBusy(true);
    try {
      const d = await postJson<{ profile: { code: string; nameTh: string } }>("/api/documents/profile", { kind: doc.kind, no: doc.no, profileId: id });
      onChange(id);
      push({ kind: "success", title: "เปลี่ยนออกเอกสารในนามแล้ว", desc: `${doc.no} → ${d.profile.code} — ${d.profile.nameTh}` });
    } catch (e) {
      push({ kind: "error", title: "เปลี่ยนออกเอกสารในนามไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field
      label="ออกเอกสารในนาม"
      className={className}
      hint={doc ? "เปลี่ยนได้ทุกเมื่อ มีผลกับเอกสารที่พิมพ์ (เลขที่เอกสารไม่เปลี่ยน)" : "หัวกระดาษ โลโก้ ที่อยู่ และเลขภาษีที่จะพิมพ์บนเอกสาร"}
    >
      <Select value={value || def?.id || ""} disabled={busy} onChange={(e) => void change(Number(e.target.value))}>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code} — {p.nameTh}
          </option>
        ))}
      </Select>
    </Field>
  );
}
