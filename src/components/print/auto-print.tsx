'use client';

import * as React from 'react';
import { Printer, X } from 'lucide-react';

/** the widest sheet (A4 / A5 landscape = 210 mm ≈ 794 px) + a little room */
const SHEET_PX = 820;

/**
 * Print toolbar (hidden on paper) + auto-open the print dialog once fonts are ready.
 * On a phone the 210 mm sheet is scaled down to the screen (screen only — the print stays A4 / A5).
 * `paper`: the sheet the page's @page sets (the shipping label: A5 แนวนอน), named in the toolbar.
 */
export function AutoPrint({ paper = 'A4' }: { paper?: string }) {
  React.useEffect(() => {
    const fit = () =>
      document.documentElement.style.setProperty(
        '--sheet-zoom',
        String(Math.min(1, document.documentElement.clientWidth / SHEET_PX)),
      );
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  React.useEffect(() => {
    const t = setTimeout(() => {
      if (new URLSearchParams(window.location.search).get('auto') !== '0') window.print();
    }, 400);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="no-print mb-4 flex items-center justify-between rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm">
      <span className="text-neutral-600">
        ตัวอย่างก่อนพิมพ์ — กระดาษ {paper} · ใช้ "บันทึกเป็น PDF" ในหน้าต่างพิมพ์หากต้องการไฟล์
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3 py-1.5 text-white"
        >
          <Printer className="h-4 w-4" /> พิมพ์
        </button>
        <button
          onClick={() => window.close()}
          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5"
        >
          <X className="h-4 w-4" /> ปิด
        </button>
      </div>
      <style>{'@media screen { .print-root { zoom: var(--sheet-zoom, 1); } }'}</style>
    </div>
  );
}
