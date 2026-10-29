'use client';

import * as React from 'react';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useDocumentProfiles } from '@/data/db';
import { postJson, errMsg, ApiError } from '@/lib/api';
import { useAccess } from '@/lib/use-access';
import { DOC_MODULE, type DocumentKind } from '@/lib/profile-lock';

/**
 * "ออกเอกสารในนาม" — which company/brand a job, quotation or sale order is
 * printed under (letterhead only; the document number is never affected).
 *  - new document: just form state, saved with the document
 *  - existing document (`doc` given): changing it saves immediately through
 *    POST /api/documents/profile (audited), so the print pages pick it up — and
 *    the hint says so. Fixed (disabled, the reason as hint) without edit on the
 *    document's module, or once it is approved / closed (`locked`, profileLock;
 *    the server refuses the same with 409 — a 409 met here locks it too)
 */
export function ProfileSelect({
  value,
  onChange,
  doc,
  locked,
  className,
}: {
  /** the document profile's uuid; '' / undefined = default profile */
  value?: string;
  /** `how`: "user" = picked here (an edit to save) · "default" = pre-picked for a new document ·
   *  "saved" = already saved on the spot — neither of the last two is an unsaved edit */
  onChange: (id: string, how: 'user' | 'default' | 'saved') => void;
  /** the document this belongs to once it has a number — enables save-on-change */
  doc?: { kind: DocumentKind; no: string };
  /** why the saved document's profile is fixed (profileLock in src/lib/profile-lock.ts); '' / undefined = it is not */
  locked?: string;
  className?: string;
}) {
  const { push } = useToast();
  const { can } = useAccess();
  // the server's 409 (approved / closed meanwhile) — for that document only (job-form keeps this mounted across jobs)
  const [refused, setRefused] = React.useState({ no: '', why: '' });
  const { data: profiles, ...profilesLookup } = useDocumentProfiles();
  const [busy, setBusy] = React.useState(false);
  const def = profiles.find((p) => p.isDefault) ?? profiles[0];

  // pre-pick the default once the list arrives so the saved value is always explicit
  React.useEffect(() => {
    if (!doc && !value && def) onChange(def.id, 'default');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def?.id, !!doc]);

  // a single profile = nothing to choose; keep the form unchanged (a failed load still says so, with a retry)
  if (profiles.length <= 1 && !profilesLookup.error) return null;

  const change = async (id: string) => {
    if (!doc) return onChange(id, 'user');
    setBusy(true);
    try {
      const d = await postJson<{ profile: { code: string; nameTh: string } }>('/api/documents/profile', {
        kind: doc.kind,
        no: doc.no,
        profileId: id,
      });
      onChange(id, 'saved');
      push({
        kind: 'success',
        title: 'เปลี่ยนออกเอกสารในนามแล้ว',
        desc: `${doc.no} → ${d.profile.code} — ${d.profile.nameTh}`,
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setRefused({ no: doc.no, why: errMsg(e) });
      push({ kind: 'error', title: 'เปลี่ยนออกเอกสารในนามไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  const fixed = !doc
    ? ''
    : locked ||
      (refused.no === doc.no && refused.why) ||
      (can(DOC_MODULE[doc.kind], 'edit') ? '' : 'ไม่มีสิทธิ์แก้ไขเอกสารนี้ — เปลี่ยนออกเอกสารในนามไม่ได้');

  return (
    <Field
      label="ออกเอกสารในนาม"
      className={className}
      lookup={profilesLookup}
      hint={
        fixed ||
        (doc
          ? 'บันทึกทันทีเมื่อเลือก (ไม่ต้องกดบันทึก) · มีผลกับเอกสารที่พิมพ์ เลขที่เอกสารไม่เปลี่ยน'
          : 'หัวกระดาษ โลโก้ ที่อยู่ และเลขภาษีที่จะพิมพ์บนเอกสาร')
      }
    >
      {/* on a saved document a change saves at once: a บทสอน never lets it be tried (data-tour-block) */}
      <Select
        value={value || def?.id || ''}
        disabled={busy || !!fixed}
        data-tour-block={doc ? '' : undefined}
        onChange={(e) => void change(e.target.value)}
      >
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code} — {p.nameTh}
          </option>
        ))}
      </Select>
    </Field>
  );
}
