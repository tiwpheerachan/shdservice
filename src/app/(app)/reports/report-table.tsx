'use client';

import * as React from 'react';
import type { Column } from '@/components/ui/data-table';
import type { Params } from '@/data/keys';
import { exportXlsx } from '@/lib/api';
import { useAccess } from '@/lib/use-access';
import { baht, int } from '@/lib/utils';
import { REPORT_SPECS, type ReportKey, type ReportRow } from './report-specs';

/** a report's table columns from its spec, in the legacy order; ราคาทุน only with Product Cost (the API leaves it
 *  out too). Not sortable: the legacy reports read in their own order (newest first). */
export function useReportColumns(report: ReportKey): Column<ReportRow>[] {
  const cost = useAccess().has('Product Cost');
  return React.useMemo(
    () =>
      REPORT_SPECS[report].cols
        .filter((c) => cost || !c.cost)
        .map((c): Column<ReportRow> => {
          const n = c.money || c.num;
          return {
            key: c.key,
            header: c.header,
            headerWrap: true,
            sortable: false,
            align: n ? 'right' : undefined,
            minWidth: n ? undefined : `${Math.min(c.width ?? 12, 30) * 7}px`,
            cell: (r) => {
              const v = r[c.key];
              if (c.money) return baht(Number(v ?? 0));
              if (c.num) return int(Number(v ?? 0));
              return <span className="line-clamp-2">{v}</span>;
            },
          };
        }),
    [report, cost],
  );
}

/** this page's @font-face rules with absolute urls for the print tab: a rule copied as written resolves its relative url against the page, not its stylesheet */
function appFontFaces(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // another origin's sheet: not ours to read
    }
    for (const r of Array.from(rules)) {
      if (!(r instanceof CSSFontFaceRule) || !/Noto Sans Thai/i.test(r.style.getPropertyValue('font-family'))) continue;
      const base = sheet.href ?? location.href;
      out.push(
        r.cssText.replace(
          /url\((['"]?)([^'")]+)\1\)/g,
          (_, q: string, u: string) => `url(${q}${new URL(u, base).href}${q})`,
        ),
      );
    }
  }
  return out.join('\n');
}

/** PDF = the print view written into a new tab and printed; Word / PDF stop at 3,000 rows and say so on the page */
export function reportExport(resource: string, params: Params, file: string) {
  return async (format: 'xlsx' | 'doc' | 'pdf', cond: string) => {
    if (format === 'xlsx') return exportXlsx(resource, { ...params, file });
    if (format === 'doc') return void (await exportXlsx(resource, { ...params, file, cond, format: 'doc' }));
    // opened while still inside the click — a tab opened after the await is a pop-up the browser blocks
    const w = window.open('', '_blank');
    if (!w) throw new Error('เบราว์เซอร์บล็อกหน้าต่างใหม่ — อนุญาตป๊อปอัปของเว็บนี้แล้วลองอีกครั้ง');
    w.document.write('<p style="font-family:sans-serif">กำลังเตรียมรายงาน…</p>');
    try {
      const { html } = (await exportXlsx(resource, { ...params, cond, format: 'html' })) as { html: string };
      w.document.open();
      w.document.write(html.replace('</head>', `<style>${appFontFaces()}</style></head>`));
      w.document.close();
      // the font files load once the text needs them: wait for them (at most 5 s), or the PDF falls back
      await Promise.race([
        w.document.fonts.load('16px "Noto Sans Thai"', 'กขค ABC').then(() => w.document.fonts.ready),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
      w.focus();
      w.print();
    } catch (e) {
      w.close();
      throw e;
    }
  };
}
