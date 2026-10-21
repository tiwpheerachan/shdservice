'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { FileSearch, Lock, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAccess } from '@/lib/use-access';

/** stays usable on a view-only page: the save bar (ยกเลิก / พิมพ์), tabs, and anything marked data-readonly-keep */
const KEEP = '[data-sticky-actions], [role="tab"], [data-readonly-keep]';
/** inputs that honour readOnly (the value can still be selected / copied) — the rest get disabled */
const NO_READONLY = ['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'image', 'color', 'range'];

/**
 * The edit / workflow screens that start with "ระบุหมายเลข…": until a record is loaded the form and
 * its save bar are hidden and one of these shows instead —
 *  - nothing loaded yet → a card that points at the search box (its button focuses / opens it)
 *  - loading → a skeleton in the form's place
 *  - lookup failed → the error, with a button to search again
 *
 * The form stays mounted (only hidden) so its state and effects behave exactly as when visible.
 *
 * A role without `edit` on the page's module (lib/modules: the route → module) sees the record
 * read-only: every input / select / textarea / button inside is locked (the page's own controls,
 * the pickers, + / ลบ rows), except the save bar (ยกเลิก, พิมพ์), tabs and `data-readonly-keep`.
 * Done on the DOM, not per component, so no form can forget a control; the observer re-locks rows
 * added later and a `disabled` React turns back off. The API refuses the write regardless.
 *
 * `loading` with a record on screen (it is being read again — โหลดใหม่ after a 409): the whole form, the
 * save button included, is disabled until the fresh record replaces it.
 */
export function RecordGate({
  ready,
  loading,
  error,
  noun,
  searchId,
  children,
}: {
  /** a record is loaded — show the form */
  ready: boolean;
  loading?: boolean;
  error?: string | null;
  /** what is looked up: "งาน" / "ใบเสนอราคา" / "ใบสั่งขาย" */
  noun: string;
  /** id of the page's search control (JobSearch trigger / lookup input) */
  searchId: string;
  children: React.ReactNode;
}) {
  const readOnly = !useAccess().forPath(usePathname()).edit;
  const box = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = box.current;
    if (!readOnly || !el) return;
    const lock = () => {
      for (const c of el.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement
      >('input, textarea, select, button')) {
        if (c.closest(KEEP)) continue;
        const ro = c instanceof HTMLTextAreaElement || (c instanceof HTMLInputElement && !NO_READONLY.includes(c.type));
        if (ro) (c as HTMLInputElement).readOnly ||= true;
        else c.disabled ||= true;
      }
    };
    lock();
    const mo = new MutationObserver(lock);
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'readonly'] });
    return () => mo.disconnect();
  }, [readOnly]);

  const focusSearch = () => {
    const el = document.getElementById(searchId);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
    if (el instanceof HTMLButtonElement)
      el.click(); // JobSearch: open its list
    else if (el instanceof HTMLInputElement) el.select();
  };

  return (
    <>
      {!ready &&
        (loading ? (
          <div role="status" aria-label={`กำลังเรียกข้อมูล${noun}`} className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="surface space-y-4 p-4">
                <Skeleton className="h-4 w-40" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {Array.from({ length: 4 }, (_, j) => (
                    <div key={j} className="space-y-1.5">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-9 w-full" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="surface flex flex-col items-center gap-3 px-4 py-14 text-center">
            <div
              className={`grid h-12 w-12 place-items-center rounded-full ${error ? 'bg-danger-soft text-danger' : 'bg-primary-soft text-primary'}`}
            >
              {error ? <SearchX className="h-6 w-6" aria-hidden /> : <FileSearch className="h-6 w-6" aria-hidden />}
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-semibold">
                {error ? `เรียกข้อมูล${noun}ไม่สำเร็จ` : `ระบุหมายเลข${noun}เพื่อเรียกข้อมูล`}
              </h2>
              <p className="max-w-md text-sm text-muted-foreground" role={error ? 'alert' : undefined}>
                {error ?? `ค้นหาหรือพิมพ์หมายเลข${noun}ในช่องด้านบน ข้อมูลและปุ่มบันทึกจะแสดงเมื่อเรียกข้อมูลสำเร็จ`}
              </p>
            </div>
            <Button variant={error ? 'outline' : 'primary'} size="md" type="button" onClick={focusSearch}>
              {error ? 'ค้นหาใหม่' : `ค้นหา${noun}`}
            </Button>
          </div>
        ))}
      <div ref={box} hidden={!ready} className="space-y-4">
        {readOnly && (
          <Badge tone="warning" className="text-xs">
            <Lock className="h-3 w-3" aria-hidden />
            ดูอย่างเดียว — บัญชีนี้ไม่มีสิทธิ์แก้ไขหน้านี้
          </Badge>
        )}
        <fieldset disabled={ready && loading} aria-busy={ready && loading} className="min-w-0 space-y-4">
          {children}
        </fieldset>
      </div>
    </>
  );
}
