'use client';

import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';

/**
 * A page of the staff app threw while rendering (DB blip, a bug). Keeps the app
 * shell, says so in Thai, and offers a retry. The digest matches the server log
 * line, so staff can quote it.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <div className="surface w-full max-w-md p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <TriangleAlert className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-lg font-semibold">หน้านี้โหลดไม่สำเร็จ</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง ถ้ายังไม่ได้ แจ้งผู้ดูแลพร้อมรหัสอ้างอิงด้านล่าง
        </p>
        {error.digest && <p className="mt-3 font-mono text-xs text-muted-foreground">รหัสอ้างอิง {error.digest}</p>}
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            ลองใหม่
          </button>
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
          >
            กลับหน้าหลัก
          </Link>
        </div>
      </div>
    </div>
  );
}
