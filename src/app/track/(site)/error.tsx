"use client";

/**
 * Customer-facing: a tracking page failed (DB blip). Keeps the company header from the
 * layout, says so plainly, offers a retry — no staff wording, no link into the staff app.
 */
export default function TrackError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="surface p-8 text-center">
      <h1 className="text-lg font-semibold">ขออภัย ระบบขัดข้องชั่วคราว</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">กรุณาลองใหม่อีกครั้งในอีกสักครู่</p>
      {error.digest && <p className="mt-3 font-mono text-xs text-muted-foreground">รหัสอ้างอิง {error.digest}</p>}
      <button
        type="button"
        onClick={() => retry()}
        className="mt-6 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        ลองใหม่
      </button>
    </div>
  );
}
