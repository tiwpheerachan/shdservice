"use client";

import * as React from "react";
import { Download, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { errMsg } from "@/lib/api";

/**
 * The "ส่งออก Excel" button of every list / report: `run` is the download (exportXlsx(...)).
 * Busy while the file is built (up to 50k rows takes a few seconds), and a refusal — too many
 * exports a minute, no permission, a server error — is a toast; the page stays as it is.
 */
export function ExportButton({
  run,
  label = "ส่งออก Excel",
  icon: Icon = Download,
}: {
  run: () => Promise<unknown>;
  label?: string;
  icon?: LucideIcon;
}) {
  const { push } = useToast();
  const [busy, setBusy] = React.useState(false);
  const onClick = async () => {
    setBusy(true);
    try {
      await run();
    } catch (e) {
      push({ kind: "error", title: "ส่งออกไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" size="sm" type="button" onClick={onClick} loading={busy}>
      {!busy && <Icon className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}
