"use client";

import * as React from "react";
import { Field, ReadOnly } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { useDocumentProfiles } from "@/data/db";

/**
 * "ออกเอกสารในนาม" — which company/brand a job, quotation or sale order is issued
 * under. Editable only while the document has no number yet: the prefix of the
 * number (J…, HJ…) is bound to the profile, so existing documents show it read-only.
 */
export function ProfileSelect({
  value,
  onChange,
  locked,
  className,
}: {
  /** document_profile.id; 0 / undefined = default profile */
  value?: number;
  onChange: (id: number) => void;
  /** document already numbered → read-only */
  locked?: boolean;
  className?: string;
}) {
  const { data: profiles } = useDocumentProfiles();
  const def = profiles.find((p) => p.isDefault) ?? profiles[0];
  const current = profiles.find((p) => p.id === value) ?? (value ? undefined : def);

  // pre-pick the default once the list arrives so the saved value is always explicit
  React.useEffect(() => {
    if (!locked && !value && def) onChange(def.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def?.id, locked]);

  // a single profile = nothing to choose; keep the form unchanged
  if (!locked && profiles.length <= 1) return null;

  return (
    <Field label="ออกเอกสารในนาม" className={className} hint={locked ? "ผูกกับเลขที่เอกสารแล้ว เปลี่ยนไม่ได้" : "กำหนดชุดเลขที่เอกสารและหัวกระดาษ"}>
      {locked ? (
        <ReadOnly>{current ? `${current.code} — ${current.nameTh}` : value ? `#${value}` : "—"}</ReadOnly>
      ) : (
        <Select value={value || def?.id || ""} onChange={(e) => onChange(Number(e.target.value))}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.nameTh}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
