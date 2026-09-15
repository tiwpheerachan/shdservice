"use client";

import * as React from "react";
import { Paperclip, Trash2, Upload, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { api, del, errMsg } from "@/lib/api";

type Row = { id: number; name: string; note: string; file?: string; pending?: File };

/**
 * Job attachments (document_attach + Supabase Storage).
 *  - with `jobNo`: uploads immediately and lists the job's existing files
 *  - without (new job): files are queued; the page calls `uploadPending(jobNo)`
 *    from the ref after the job number exists.
 */
export type AttachmentsHandle = { uploadPending: (jobNo: string) => Promise<void> };

export const Attachments = React.forwardRef<AttachmentsHandle, { jobNo?: string }>(function Attachments({ jobNo }, ref) {
  const { push } = useToast();
  const [rows, setRows] = React.useState<Row[]>([]);
  const [file, setFile] = React.useState<File | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const idRef = React.useRef(0);

  // existing files of a loaded job
  React.useEffect(() => {
    if (!jobNo) {
      setRows([]);
      return;
    }
    let active = true;
    api<{ job: { attachments: { id: number; name: string; file: string; remark: string }[] } }>(`/api/jobs/${encodeURIComponent(jobNo)}`)
      .then((d) => active && setRows(d.job.attachments.map((a) => ({ id: a.id, name: a.name, note: a.remark, file: a.file }))))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [jobNo]);

  const upload = async (target: string, f: File, remark: string) => {
    const fd = new FormData();
    fd.append("file", f);
    fd.append("jobNo", target);
    fd.append("remark", remark);
    return api<{ row: { id: number; name: string; file: string; remark: string } }>("/api/attachments", { method: "POST", body: fd });
  };

  React.useImperativeHandle(ref, () => ({
    uploadPending: async (target: string) => {
      const pending = rows.filter((r) => r.pending);
      for (const r of pending) {
        try {
          await upload(target, r.pending!, r.note);
        } catch (e) {
          push({ kind: "error", title: `แนบไฟล์ ${r.name} ไม่สำเร็จ`, desc: errMsg(e) });
        }
      }
    },
  }));

  const add = async () => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      push({ kind: "error", title: "ไฟล์ใหญ่เกิน 10MB", desc: file.name });
      return;
    }
    if (!jobNo) {
      // queue until the job exists
      setRows((r) => [...r, { id: -(++idRef.current), name: file.name, note, pending: file }]);
      setFile(null);
      setNote("");
      return;
    }
    setBusy(true);
    try {
      const d = await upload(jobNo, file, note);
      setRows((r) => [...r, { id: d.row.id, name: d.row.name, note: d.row.remark, file: d.row.file }]);
      setFile(null);
      setNote("");
      push({ kind: "success", title: "แนบไฟล์แล้ว", desc: d.row.name });
    } catch (e) {
      push({ kind: "error", title: "แนบไฟล์ไม่สำเร็จ", desc: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Row) => {
    if (r.id < 0) {
      setRows((s) => s.filter((x) => x.id !== r.id));
      return;
    }
    try {
      await del(`/api/attachments/${r.id}`);
      setRows((s) => s.filter((x) => x.id !== r.id));
    } catch (e) {
      push({ kind: "error", title: "ลบไฟล์ไม่สำเร็จ", desc: errMsg(e) });
    }
  };

  const name = file?.name ?? "";

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border border-dashed border-input bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground">
          <Upload className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {name || "เลือกไฟล์แนบ (PDF, JPG, PNG — ไม่เกิน 10MB)"}
          </span>
          <input
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="คำอธิบายเพิ่มเติม"
          className="sm:w-64"
        />
        <Button variant="outline" size="md" onClick={add} disabled={!file || busy}>
          <Paperclip className="h-3.5 w-3.5" />
          แนบไฟล์
        </Button>
      </div>

      <div className="table-scroll border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
              <th className="w-10 px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">เอกสารแนบ</th>
              <th className="px-3 py-2 text-left">คำอธิบายเพิ่มเติม</th>
              <th className="w-20 px-3 py-2 text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  ยังไม่มีเอกสารแนบ
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={r.id} className="border-b border-border/70 last:border-0">
                  <td className="num px-3 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2">
                    {r.id > 0 ? (
                      <a
                        href={`/api/attachments/${r.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 hover:underline"
                      >
                        <FileText className="h-3.5 w-3.5 text-primary" />
                        {r.name}
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 text-primary" />
                        {r.name}
                        <span className="text-2xs text-muted-foreground">(รอบันทึก)</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.note || "—"}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => remove(r)}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-danger-soft hover:text-danger"
                      aria-label="ลบ"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
});
