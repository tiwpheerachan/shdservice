import { COMPANY } from "@/lib/company";
import { AutoPrint } from "./auto-print";

/**
 * A4 document shell shared by every print view: company header, title box,
 * body, and a print button bar that is hidden when printing.
 */
export function PrintFrame({
  title,
  docNo,
  meta,
  children,
}: {
  title: string;
  docNo: string;
  meta: { label: string; value: string }[];
  children: React.ReactNode;
}) {
  return (
    <div className="print-page">
      <AutoPrint />
      <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={COMPANY.logo} alt="" className="h-10 w-auto" />
          <div className="text-[11px] leading-snug">
            <p className="text-sm font-semibold">{COMPANY.nameTh}</p>
            <p>{COMPANY.nameEn}</p>
            {COMPANY.address && <p>{COMPANY.address}</p>}
            <p>
              {COMPANY.phone && <>โทร {COMPANY.phone} </>}
              {COMPANY.email && <>· {COMPANY.email} </>}
              {COMPANY.taxId && <>· เลขประจำตัวผู้เสียภาษี {COMPANY.taxId}</>}
            </p>
          </div>
        </div>
        <div className="min-w-[220px] text-right">
          <h1 className="text-lg font-bold">{title}</h1>
          <p className="num text-base font-semibold">{docNo}</p>
          <dl className="mt-1 text-[11px]">
            {meta.map((m) => (
              <div key={m.label} className="flex justify-end gap-2">
                <dt className="text-neutral-500">{m.label}</dt>
                <dd className="num">{m.value || "—"}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>
      <main className="mt-4 space-y-4 text-[12px] leading-relaxed">{children}</main>
    </div>
  );
}

export function Box({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`break-inside-avoid rounded border border-neutral-400 ${className}`}>
      <h2 className="border-b border-neutral-400 bg-neutral-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide">{title}</h2>
      <div className="px-3 py-2">{children}</div>
    </section>
  );
}

export function KV({ items, cols = 2 }: { items: { k: string; v?: string | number | null }[]; cols?: 2 | 3 }) {
  return (
    <dl className={`grid gap-x-6 gap-y-1 ${cols === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
      {items.map((it) => (
        <div key={it.k} className="flex gap-2">
          <dt className="w-32 shrink-0 text-neutral-500">{it.k}</dt>
          <dd className="min-w-0 flex-1 break-words">{it.v === null || it.v === undefined || it.v === "" ? "—" : it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Signatures({ left, right }: { left: string; right: string }) {
  return (
    <div className="mt-10 grid grid-cols-2 gap-10 break-inside-avoid">
      {[left, right].map((l) => (
        <div key={l} className="text-center">
          <div className="mx-auto mb-1 h-10 w-56 border-b border-dotted border-neutral-500" />
          <p>{l}</p>
          <p className="text-neutral-500">วันที่ ______ / ______ / ________</p>
        </div>
      ))}
    </div>
  );
}

export const money = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
