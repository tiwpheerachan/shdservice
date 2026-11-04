import { notFound } from 'next/navigation';
import { getJob } from '@/server/services/jobs';
import { AutoPrint } from '@/components/print/auto-print';
import { money } from '@/components/print/print-frame';
import { REPAIR_CLOSE_TERMS } from '@/lib/company';
import { profileForDocument } from '@/server/services/document-profiles';
import { parseSwap } from '@/lib/validation/job';

const dash = (v: string | null | undefined) => (v && v.trim() ? v : '—');

function Row({ k, v, className = '' }: { k: string; v: React.ReactNode; className?: string }) {
  return (
    <div className={`flex gap-2 ${className}`}>
      <dt className="w-36 shrink-0 text-neutral-600">{k}</dt>
      <dd className="min-w-0 flex-1 whitespace-pre-line wrap-break-word">{v}</dd>
    </div>
  );
}

/** ใบปิดงานซ่อม — the legacy repair close sheet, printable at any status (a job not repaired yet has empty repair fields) */
export async function RepairCloseDoc({ no }: { no: string }) {
  const j = await getJob(no);
  if (!j) notFound();
  const co = await profileForDocument(j.documentProfileId);
  const c = j.customer;
  // issued less returned to stock, as the return note bills it; a line returned in full is not printed
  const used = (p: (typeof j.parts)[number]) => (p.granted > 0 ? p.granted - p.returned : p.requested);
  const parts = j.parts.filter((p) => (p.statusId === 3 || p.granted > 0) && used(p) > 0);
  const newSerial = parseSwap(j.sparePartReplace)['New S/N'];

  return (
    <main className="print-page text-[11px] leading-snug text-black">
      <AutoPrint />
      <header className="relative flex items-center border-b-2 border-black pb-2">
        <img src={co.logoUrl} alt={co.code} className="h-10 w-auto" />
        <span className="ml-2 text-sm font-semibold">Service Center</span>
        <h1 className="absolute left-1/2 -translate-x-1/2 text-lg font-bold">ใบปิดงานซ่อม</h1>
      </header>

      <div className="mt-3 space-y-2">
        <div className="grid grid-cols-2 gap-6">
          <dl className="space-y-0.5">
            <Row k="รหัสลูกค้า" v={dash(c?.code)} />
            <Row k="ชื่อลูกค้า" v={dash(c?.name || j.customerDetail)} />
            <Row k="ที่อยู่" v={dash(c?.address)} />
            <Row k="เบอร์โทรศัพท์" v={<span className="num">{dash(c?.phone)}</span>} />
          </dl>
          <dl className="space-y-0.5">
            <Row k="หมายเลขงานซ่อม" v={<span className="num text-base font-bold">{j.no}</span>} />
            <Row k="วันที่เปิดงาน" v={<span className="num">{dash(j.createDate)}</span>} />
            <Row k="เลขคำสั่งซื้อ" v={<span className="num">{dash(j.so)}</span>} />
            <Row k="ยี่ห้อ" v={dash(j.brand)} />
            <Row k="รุ่น" v={dash(j.modelName)} />
            <Row
              k="Serial No / IMEI"
              v={<span className="num">{dash([j.serial, j.imei].filter(Boolean).join(' / '))}</span>}
            />
          </dl>
        </div>

        <dl className="space-y-0.5 rounded border border-neutral-400 px-3 py-2">
          <Row k="อาการเสีย (ลูกค้าแจ้ง)" v={dash(j.symptoms.join(', '))} />
          <Row k="อาการเสียอื่นๆ" v={dash(j.symptomOther)} />
          <Row k="อุปกรณ์ (มาพร้อมเครื่อง)" v={dash(j.equipment)} />
          <Row k="หมายเหตุ" v={dash(j.remark)} />
        </dl>

        <section className="rounded border border-neutral-400">
          <h2 className="break-after-avoid border-b border-neutral-400 bg-neutral-100 px-3 py-1 font-semibold">
            รายละเอียดการซ่อม
          </h2>
          <dl className="space-y-0.5 px-3 py-2">
            <div className="grid grid-cols-2 gap-6">
              <Row k="ชื่อนายช่าง" v={dash(j.repairedBy || j.engineer)} />
              <Row k="วันที่ซ่อมเสร็จ" v={<span className="num">{dash(j.repairedDate)}</span>} />
            </div>
            <Row k="อาการเสีย ที่พบ" v={dash(j.engineerSymptoms.join(', '))} />
            <Row k="วิธีการซ่อม" v={dash(j.repairDetail)} />
            <Row
              k="รายการอะไหล่ ที่ใช้"
              v={
                parts.length ? (
                  <ul aria-label="รายการอะไหล่ ที่ใช้">
                    {parts.map((p) => (
                      <li key={p.logId} className="flex gap-2">
                        <span className="num">{p.code}</span>
                        <span className="min-w-0 flex-1 wrap-anywhere">{p.name}</span>
                        <span className="num">x {used(p)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  '—'
                )
              }
            />
            <div className="grid grid-cols-2 gap-6">
              <Row k="New Serial No." v={<span className="num">{dash(newSerial)}</span>} />
              {/* the job's stored total (job_total_cost) — never recomputed here */}
              <Row k="ราคาค่าซ่อมทั้งหมด" v={<span className="num font-semibold">{money(j.totalCost)} บาท</span>} />
            </div>
            <Row k="หมายเหตุ" v={dash(j.engineerRemark)} />
          </dl>
        </section>

        {/* a sheet too long for one page moves the terms over with the signatures, never the signatures alone */}
        <div className="break-inside-avoid space-y-2">
          <section>
            <h2 className="font-semibold">เงื่อนไขการให้บริการ</h2>
            <ol className="list-decimal space-y-0.5 pl-5">
              {REPAIR_CLOSE_TERMS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          </section>

          <div className="grid grid-cols-2 gap-6">
            {['ผู้ตรวจเช็ค (By SV)', 'ผู้ตรวจสอบโดย (By QC)'].map((l) => (
              <div key={l} className="space-y-4 rounded border border-neutral-400 px-3 py-3">
                <p className="flex items-end gap-2">
                  <span className="shrink-0">{l}</span>
                  <span className="h-4 flex-1 border-b border-dotted border-neutral-500" />
                </p>
                <p className="flex items-end gap-2">
                  <span className="shrink-0">วันที่ (Date)</span>
                  <span className="h-4 flex-1 border-b border-dotted border-neutral-500" />
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
