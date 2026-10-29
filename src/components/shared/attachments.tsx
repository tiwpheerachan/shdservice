'use client';

import * as React from 'react';
import { Paperclip, Trash2, Upload, FileText, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TableScroll } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { ApiError, del, errMsg, fileUrl, qs, upload as send } from '@/lib/api';
import { MAY_NOT_PLAY, isVideo, isVideoFile, prepareVideo, uploadVideo, type PreparedVideo } from '@/lib/video';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useAccess } from '@/lib/use-access';

/** `id` = document_attach.id (uuid); a queued file (`pending`, not uploaded yet) has a client-only `tmp-…` key */
type Row = { id: string; name: string; note: string; file?: string; pending?: File };
/** src/server/storage.ts R2_MISSING */
const VIDEO_OFF = 'ยังไม่ได้ตั้งค่าที่เก็บวิดีโอ — ติดต่อผู้ดูแลระบบ';
type SavedFile = { id: string; name: string; file: string; remark: string };
/** files = the loaded job's attachments (JobDetail.attachments) */
export type AttachmentsProps = { jobNo?: string; files?: SavedFile[] };

/**
 * Job attachments (document_attach + Supabase Storage; videos in Cloudflare R2).
 *  - with `jobNo`: uploads immediately and lists the job's existing files
 *  - without (new job): files are queued; the page calls `uploadPending(jobNo)`
 *    from the ref after the job number exists.
 * A video (MP4 / MOV / WebM, ≤ 3 min) is converted here first and goes straight to storage (src/lib/video.ts),
 * with its progress and ยกเลิก on screen; it opens in a player. Staff only, as every attachment.
 */
export type AttachmentsHandle = { uploadPending: (jobNo: string) => Promise<void> };

export const Attachments = React.forwardRef<AttachmentsHandle, AttachmentsProps>(function Attachments(
  { jobNo, files },
  ref,
) {
  const { push } = useToast();
  const confirm = useConfirm();
  // removing a saved file needs Job Management delete (the API refuses others); a queued one is just dropped
  const access = useAccess();
  const canDelete = access.can('Job Management', 'del');
  // attaching needs Job Management edit (POST /api/attachments refuses others): a view-only user sees just the list
  const canAttach = access.can('Job Management', 'edit');
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
  // a video being converted / uploaded: what it is doing, and its ยกเลิก
  const [progress, setProgress] = React.useState<{ label: string; pct: number } | null>(null);
  const abort = React.useRef<AbortController | null>(null);
  // each picked video converted once: a failed upload (or the queue of a new job) sends the same result again
  const prepared = React.useRef(new WeakMap<File, PreparedVideo>());
  const [playing, setPlaying] = React.useState<{ name: string; src: string; download?: string } | null>(null);
  // why the player stopped: the file is not in storage, or this browser cannot play it
  const [playError, setPlayError] = React.useState<'' | 'missing' | 'unplayable'>('');
  // files queued for a job not saved yet are an unsaved edit (they upload with the job), and so is a file
  // picked but not "แนบไฟล์"-ed yet, and a video on its way
  useUnsavedChanges(rows.some((r) => r.pending) || !!file || !!progress);

  // shrunk photo, progress, "ลองอีกครั้ง" on a failure (the file is kept) — lib/api upload
  const upload = (target: string, f: File, remark: string) =>
    send<{ row: { id: string; name: string; file: string; remark: string } }>(
      '/api/attachments',
      { jobNo: target, remark },
      f,
    );

  /** runs a video step with the progress line on screen; null = ยกเลิก was pressed */
  const withProgress = async <T,>(fn: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    const ctl = new AbortController();
    abort.current = ctl;
    setProgress({ label: 'กำลังตรวจวิดีโอ…', pct: 0 });
    try {
      return await fn(ctl.signal);
    } catch (e) {
      if (!ctl.signal.aborted) throw e;
      push({ kind: 'info', title: 'ยกเลิกการแนบวิดีโอแล้ว' });
      return null;
    } finally {
      abort.current = null;
      setProgress(null);
    }
  };
  const prepare = async (f: File, signal: AbortSignal) => {
    let v = prepared.current.get(f);
    if (!v) {
      v = await prepareVideo(f, (pct) => setProgress({ label: 'กำลังแปลงวิดีโอ…', pct }), signal);
      prepared.current.set(f, v);
      if (!v.converted)
        push({ kind: 'info', title: 'เบราว์เซอร์นี้แปลงวิดีโอไม่ได้ — จะส่งไฟล์ต้นฉบับ', desc: MAY_NOT_PLAY });
    }
    return v;
  };
  const sendVideo = (target: string, f: File, remark: string) =>
    withProgress(async (signal) => {
      const v = await prepare(f, signal);
      setProgress({ label: 'กำลังอัปโหลด…', pct: 0 });
      return uploadVideo(target, v, remark, (pct) => setProgress({ label: 'กำลังอัปโหลด…', pct }), signal);
    });

  React.useImperativeHandle(ref, () => ({
    uploadPending: async (target: string) => {
      // a file picked but not "แนบไฟล์"-ed yet goes with the job too (it was dropped without a word)
      const picked = file ? [{ name: file.name, note, pending: file }] : [];
      const pending = [...rows.filter((r) => r.pending), ...picked];
      for (const r of pending) {
        try {
          await (isVideo(r.pending!) ? sendVideo(target, r.pending!, r.note) : upload(target, r.pending!, r.note));
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
    const video = isVideo(file);
    if (!video && file.size > 10 * 1024 * 1024) {
      push({ kind: 'error', title: 'ไฟล์ใหญ่เกิน 10MB', desc: file.name });
      return;
    }
    if (!jobNo) {
      // queue until the job exists — a video is converted now: a refused one (too long…) is told before the save
      if (video) {
        setBusy(true);
        try {
          if (!(await withProgress((signal) => prepare(file, signal)))) return;
        } catch (e) {
          push({ kind: 'error', title: 'แนบวิดีโอไม่สำเร็จ', desc: errMsg(e) });
          return;
        } finally {
          setBusy(false);
        }
      }
      setRows((r) => [...r, { id: `tmp-${++idRef.current}`, name: file.name, note, pending: file }]);
      setFile(null);
      setNote('');
      return;
    }
    setBusy(true);
    try {
      const d = video ? await sendVideo(jobNo, file, note) : await upload(jobNo, file, note);
      if (!d) return; // ยกเลิก: the file stays picked
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
    if (r.pending) {
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
      {canAttach && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border border-dashed border-input bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground">
            <Upload className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {name ||
                (access.videos
                  ? 'เลือกไฟล์แนบ (PDF, JPG, PNG, WEBP — ไม่เกิน 10MB · วิดีโอ MP4, MOV, WebM — ไม่เกิน 3 นาที)'
                  : 'เลือกไฟล์แนบ (PDF, JPG, PNG, WEBP — ไม่เกิน 10MB)')}
            </span>
            <input
              type="file"
              className="hidden"
              accept={`.pdf,.jpg,.jpeg,.png,.webp${access.videos ? ',.mp4,.m4v,.mov,.webm,video/mp4,video/quicktime,video/webm' : ''}`}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                e.target.value = ''; // the same file can be chosen again
                // no video storage (R2) configured: the API would answer 503 with the same words
                if (f && !access.videos && isVideo(f))
                  push({ kind: 'error', title: 'แนบวิดีโอไม่ได้', desc: VIDEO_OFF });
                else setFile(f);
              }}
            />
          </label>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="คำอธิบายเพิ่มเติม"
            aria-label="คำอธิบายไฟล์แนบ"
            maxLength={100} // document_attach.remark
            className="sm:w-64"
          />
          <Button variant="outline" size="md" onClick={add} disabled={!file || busy}>
            <Paperclip className="h-3.5 w-3.5" />
            แนบไฟล์
          </Button>
        </div>
      )}

      {canAttach && !access.videos && <p className="text-xs text-muted-foreground">วิดีโอ: {VIDEO_OFF}</p>}

      {progress && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-sm"
        >
          <Film className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="num shrink-0">
            {progress.label} {progress.pct}%
          </span>
          <progress value={progress.pct} max={100} className="h-1.5 min-w-0 flex-1 accent-primary" />
          <Button variant="ghost" size="sm" onClick={() => abort.current?.abort()} aria-label="ยกเลิกการแนบวิดีโอ">
            ยกเลิก
          </Button>
        </div>
      )}

      <TableScroll label="ไฟล์แนบ" className="border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/60 text-2xs uppercase tracking-wide text-muted-foreground">
              {/* a phone: # hidden, the description under the file name — nothing off-screen */}
              <th className="hidden w-10 px-3 py-2 text-left sm:table-cell">#</th>
              <th className="px-3 py-2 text-left">เอกสารแนบ</th>
              <th className="hidden px-3 py-2 text-left sm:table-cell">คำอธิบายเพิ่มเติม</th>
              <th className="w-16 px-3 py-2 text-center sm:w-20">Action</th>
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
                  <td className="num hidden px-3 py-2 text-muted-foreground sm:table-cell">{i + 1}</td>
                  <td className="px-3 py-2 wrap-anywhere">
                    {!r.pending && isVideoFile(r.file) ? (
                      <button
                        type="button"
                        onClick={() => {
                          const path = `jobs/${jobNo}/attachments/${r.file}`;
                          setPlayError('');
                          setPlaying({
                            name: r.name,
                            src: fileUrl(path),
                            download: `/api/files${qs({ path, download: '1' })}`,
                          });
                        }}
                        className="inline-flex items-center gap-2 text-left hover:underline"
                      >
                        <img
                          src={fileUrl(`jobs/${jobNo}/attachments/${r.file}.jpg`)}
                          alt=""
                          loading="lazy"
                          className="h-9 w-16 shrink-0 rounded bg-muted object-cover"
                          // no thumbnail: the browser that attached it could not make one
                          onError={(e) => {
                            e.currentTarget.hidden = true;
                          }}
                        />
                        <Film className="h-3.5 w-3.5 shrink-0 text-primary" />
                        {r.name}
                      </button>
                    ) : r.pending && isVideo(r.pending) ? (
                      // the converted clip, before the job is saved — played from memory (blob:)
                      <button
                        type="button"
                        onClick={() => {
                          const v = prepared.current.get(r.pending!);
                          setPlayError('');
                          setPlaying({ name: r.name, src: URL.createObjectURL(v?.file ?? r.pending!) });
                        }}
                        className="inline-flex items-center gap-1.5 text-left hover:underline"
                      >
                        <Film className="h-3.5 w-3.5 text-primary" />
                        {r.name}
                        <span className="text-2xs text-muted-foreground">(รอบันทึก)</span>
                      </button>
                    ) : !r.pending && r.file?.trim() ? (
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
                        {/* a legacy row without a stored file: nothing to open */}
                        <span className="text-2xs text-muted-foreground">
                          {r.pending ? '(รอบันทึก)' : '(ไม่มีไฟล์)'}
                        </span>
                      </span>
                    )}
                    {r.note && <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">{r.note}</p>}
                  </td>
                  <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{r.note || '—'}</td>
                  <td className="px-3 py-2 text-center">
                    {(r.pending || canDelete) && (
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

      <Modal
        open={!!playing}
        onClose={() => {
          if (playing?.src.startsWith('blob:')) URL.revokeObjectURL(playing.src);
          setPlaying(null);
        }}
        title={playing?.name ?? ''}
        size="lg"
        footer={
          playing?.download &&
          playError !== 'missing' && (
            <Button asChild variant="outline" size="sm">
              <a href={playing.download}>ดาวน์โหลด</a>
            </Button>
          )
        }
      >
        {playError ? (
          <p className="text-sm text-muted-foreground">
            {playError === 'missing'
              ? 'ไม่พบไฟล์วิดีโอ — อาจยังอยู่บนระบบเก่า หรือถูกลบไปแล้ว'
              : `เบราว์เซอร์นี้เล่นวิดีโอนี้ไม่ได้${playing?.download ? ' — กด ดาวน์โหลด แล้วเปิดในเครื่อง' : ''}`}
          </p>
        ) : (
          playing && (
            <video
              key={playing.src}
              src={playing.src}
              controls
              preload="metadata"
              playsInline
              onError={async () => {
                // a status probe of our own /api/files URL (not followed to storage): 404 = the file is not there
                const res = await fetch(playing.src, { redirect: 'manual' }).catch(() => null);
                setPlayError(res?.status === 404 ? 'missing' : 'unplayable');
              }}
              className="max-h-[70vh] w-full rounded-md bg-black"
            />
          )
        )}
      </Modal>
    </div>
  );
});
