'use client';

import * as React from 'react';
import { Download, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { errMsg } from '@/lib/api';
import { useAccess } from '@/lib/use-access';
import { MAX_EXPORT_ROWS } from '@/lib/export-limit';

/**
 * A refusal (rate limit, no permission, server error) is a toast; a file cut at the 20,000-row cap is a warning with
 * the full count. Hidden without the Export right (the API refuses it too).
 */
export function ExportButton({
  run,
  label = 'ส่งออก Excel',
  icon: Icon = Download,
}: {
  run: () => Promise<unknown>;
  label?: string;
  icon?: LucideIcon;
}) {
  const { push } = useToast();
  const allowed = useAccess().has('Export');
  const [busy, setBusy] = React.useState(false);
  const onClick = async () => {
    setBusy(true);
    try {
      // exportXlsx: a file cut at the cap says how many rows matched — the file alone would look complete
      const of = ((await run()) as { truncatedOf?: number } | undefined)?.truncatedOf;
      if (of)
        push({
          kind: 'warning',
          title: `ส่งออกได้ ${MAX_EXPORT_ROWS.toLocaleString('en-US')} จาก ${of.toLocaleString('en-US')} แถว — กรองให้แคบลง`,
        });
    } catch (e) {
      push({ kind: 'error', title: 'ส่งออกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };
  if (!allowed) return null;
  return (
    <Button variant="outline" size="sm" type="button" onClick={onClick} loading={busy}>
      {!busy && <Icon className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}
