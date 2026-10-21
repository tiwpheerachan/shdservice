'use client';

import * as React from 'react';
import { Paperclip, Trash2, Upload, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableScroll } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { ApiError, del, errMsg, upload as send } from '@/lib/api';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useAccess } from '@/lib/use-access';

type Row = { id: number; name: string; note: string; file?: string; pending?: File };
type SavedFile = { id: number; name: string; file: string; remark: string };
/** files = the loaded job's attachments (JobDetail.attachments) */
export type AttachmentsProps = { jobNo?: string; files?: SavedFile[] };

/**
 * Job attachments (document_attach + Supabase Storage).
 *  - with `jobNo`: uploads immediately and lists the job's existing files
 *  - without (new job): files are queued; the page calls `uploadPending(jobNo)`
 *    from the ref after the job number exists.
 */
export type AttachmentsHandle = { uploadPending: (jobNo: string) => Promise<void> };

export const Attachments = React.forwardRef<AttachmentsHandle, AttachmentsProps>(function Attachments(
  { jobNo, files },
  ref,
) {
  const { push } = useToast();
  const confirm = useConfirm();
  // removing a saved file needs Job Management delete (the API refuses others); a queued one is just dropped
  const canDelete = useAccess().can('Job Management', 'del');
  // existing files of a loaded job: `files` came with the job the page loaded (no second GET /api/jobs/:no),
  // on screen from the first render (so in the server HTML); taken again only when another job is shown, so
  // a save (same job) keeps what was uploaded here meanwhile
  const rowsOf = (no?: string): Row[] =>
    no && files ? files.map((a) => ({ id: a.id, name: a.name, note: a.remark, file: a.file })) : [];
  const [rows, setRows] = React.useState(() => rowsOf(jobNo));
  const [rowsFor, setRowsFor] = React.useState(jobNo);
  if (rowsFor !== jobNo) {
    setRowsFor(jobNo);
    setRows(rowsOf(jobNo));
  }
  const [file, setFile] = React.useState<File | null>(null);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const idRef = React.useRef(0);
  // files queued for a job not saved yet are an unsaved edit (they upload with the job), and so is a file
  // picked but not "แนบไฟล์"-ed yet
  useUnsavedChanges(rows.some((r) => r.pending) || !!file);

  // shrunk photo, progress, "ลองอีกครั้ง" on a failure (the file is kept) — lib/api upload
  const upload = (target: string, f: File, remark: string) =>
    send<{ row: { id: number; name: string; file: string; remark: string } }>(
      '/api/attachments',
      { jobNo: target, remark },
      f,
    );

  React.useImperativeHandle(ref, () => ({
    uploadPending: async (target: string) => {
      // a file picked but not "แนบไฟล์"-ed yet goes with the job too (it was dropped without a word)
      const picked = file ? [{ name: file.name, note, pending: file }] : [];
      const pending = [...rows.filter((r) => r.pending), ...picked];
      for (const r of pending) {
        try {
          await upload(target, r.pending!, r.note);
        } catch (e) {
          push({ kind: 'error', title: `แนบไฟล์ ${r.name} ไม่สำเร็จ`, desc: errMsg(e) });
        }
      }
      // the queue belonged to that job — the next new job starts with none (a failed file was toasted
      // and can be attached from the job's edit screen)
      setRows((all) => all.filter((r) => !r.pending));
      setFile(null);
      setNote('');
    },
  }));

  const add = async () => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      push({ kind: 'error', title: 'ไฟล์ใหญ่เกิน 10MB', desc: file.name });
      return;
    }
    if (!jobNo) {
      // queue until the job exists
      setRows((r) => [...r, { id: -++idRef.current, name: file.name, note, pending: file }]);
      setFile(null);
      setNote('');
      return;
    }
    setBusy(true);
    try {
      const d = await upload(jobNo, file, note);
      setRows((r) => [...r, { id: d.row.id, name: d.row.name, note: d.row.remark, file: d.row.file }]);
      setFile(null);
      setNote('');
      push({ kind: 'success', title: 'แนบไฟล์แล้ว', desc: d.row.name });
    } catch (e) {
      push({ kind: 'error', title: 'แนบไฟล์ไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Row) => {
    if (r.id < 0) {
      setRows((s) => s.filter((x) => x.id !== r.id)); // not uploaded yet — just drop it from the queue
      return;
    }
    const ok = await confirm({
      tone: 'danger',
      title: 'ลบไฟล์แนบ?',
      description: (
        <>
          <span className="font-medium">{r.name}</span> จะถูกลบออกจากงานนี้ — ถ้าต้องการกลับมาต้องอัปโหลดใหม่
        </>
      ),
      confirmLabel: 'ลบไฟล์',
    });
    if (!ok) return;
    try {
      await del(`/api/attachments/${r.id}`);
      setRows((s) => s.filter((x) => x.id !== r.id));
    } catch (e) {
      // 404: someone deleted it a moment ago — what was asked for is done
      if (e instanceof ApiError && e.status === 404) {
        setRows((s) => s.filter((x) => x.id !== r.id));
        push({ kind: 'info', title: errMsg(e), desc: r.name });
      } else push({ kind: 'error', title: 'ลบไฟล์ไม่สำเร็จ', desc: errMsg(e) });
    }
  };

  const name = file?.name ?? '';

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border border-dashed border-input bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground">
          <Upload className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{name || 'เลือกไฟล์แนบ (PDF, JPG, PNG — ไม่เกิน 10MB)'}</span>
          <input
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              e.target.value = ''; // the same file can be chosen again
            }}
          />
        </label>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="คำอธิบายเพิ่มเติม"
          aria-label="คำอธิบายไฟล์แนบ"
          className="sm:w-64"
        />
        <Button variant="outline" size="md" onClick={add} disabled={!file || busy}>
          <Paperclip className="h-3.5 w-3.5" />
          แนบไฟล์
        </Button>
      </div>

      <TableScroll label="ไฟล์แนบ" className="border border-border">
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
                  <td className="px-3 py-2 text-muted-foreground">{r.note || '—'}</td>
                  <td className="px-3 py-2 text-center">
                    {(r.id < 0 || canDelete) && (
                      <button
                        onClick={() => remove(r)}
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-danger-soft hover:text-danger"
                        aria-label="ลบ"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
});
