"use client";

import * as React from "react";
import { Printer, X } from "lucide-react";

/** Print toolbar (hidden on paper) + auto-open the print dialog once fonts are ready. */
export function AutoPrint() {
  React.useEffect(() => {
    const t = setTimeout(() => {
      if (new URLSearchParams(window.location.search).get("auto") !== "0") window.print();
    }, 400);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="no-print mb-4 flex items-center justify-between rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm">
      <span className="text-neutral-600">ตัวอย่างก่อนพิมพ์ — กระดาษ A4 · ใช้ "บันทึกเป็น PDF" ในหน้าต่างพิมพ์หากต้องการไฟล์</span>
      <div className="flex gap-2">
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-white">
          <Printer className="h-4 w-4" /> พิมพ์
        </button>
        <button onClick={() => window.close()} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5">
          <X className="h-4 w-4" /> ปิด
        </button>
      </div>
    </div>
  );
}
