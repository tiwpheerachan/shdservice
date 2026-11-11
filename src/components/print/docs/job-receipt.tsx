import { notFound } from 'next/navigation';
import { getJob, type JobDetail } from '@/server/services/jobs';
import { PrintFrame, Box, KV, money } from '@/components/print/print-frame';
import { REPAIR_PICKUP_NOTE, REPAIR_TERMS } from '@/lib/company';
import { ParcelSheet } from '@/components/print/shipping-label';
import { profileForDocument, type DocumentProfile } from '@/server/services/document-profiles';
import { jobForCustomer, receivedDateOf } from '@/server/services/tracking';
import { listShippingProfiles } from '@/server/services/shipping-profiles';
import { shipperFor } from '@/lib/shipper';
import { code128 } from '@/lib/code128';

/** `forCustomer` = opened from /track: no staff names / notes, no parcel page. */
export async function JobReceiptDoc({ no, forCustomer }: { no: string; forCustomer?: boolean }) {
  const found = await getJob(no);
  if (!found) notFound();
  const j = forCustomer ? jobForCustomer(found) : found;
  const c = j.customer;
  const co = await profileForDocument(j.documentProfileId);
  // a legacy courier name ("THAIPOST") printed as its profile (ไปรษณีย์ไทย), as /track shows it
  const shipper = shipperFor(await listShippingProfiles(false), j.receptionShipper)?.nameTh || j.receptionShipper;
  const bars = code128(j.no);
  const receipt = (
    <PrintFrame
      company={co}
      title="ใบรับงานซ่อม"
      docNo={j.no}
      meta={[
        // วันที่รับเครื่อง = /track and the return note (job_reception_date); เปิดงาน = when the job was keyed in
        { label: 'วันที่รับเครื่อง', value: receivedDateOf(j) },
        { label: 'วันที่เปิดงาน', value: j.createDate },
        ...(forCustomer ? [] : [{ label: 'ผู้รับงาน', value: j.createByName }]),
        { label: 'สถานะ', value: j.status },
      ]}
    >
      {/* the customer signs it on one A4 sheet: tighter than the frame's default spacing */}
      <div className="space-y-2 text-[11px] leading-snug">
        {/* the job number as Code 128 (as the legacy sheet): scanned at the counter to call the job up */}
        <div className="-mt-2 flex flex-col items-end">
          <svg
            viewBox={`-10 0 ${bars.length + 20} 1`}
            preserveAspectRatio="none"
            shapeRendering="crispEdges"
            className="h-[12mm] w-[52mm]"
            role="img"
            aria-label={`บาร์โค้ด ${j.no}`}
          >
            {[...bars.matchAll(/1+/g)].map((m) => (
              <rect key={m.index} x={m.index} width={m[0].length} height={1} fill="#000" />
            ))}
          </svg>
          <p className="num text-[11px] tracking-[0.2em]">{j.no}</p>
        </div>

        <Box title="ข้อมูลลูกค้า">
          <KV
            items={[
              { k: 'รหัสลูกค้า', v: c?.code },
              { k: 'ชื่อลูกค้า', v: c?.name },
              { k: 'โทรศัพท์', v: c?.phone },
              { k: 'Line ID', v: c?.line },
              { k: 'ที่อยู่', v: c?.address },
              { k: 'อีเมล', v: c?.email, email: true },
            ]}
          />
        </Box>

        <Box title="ข้อมูลสินค้า">
          <KV
            cols={3}
            items={[
              { k: 'ยี่ห้อ / รุ่น', v: [j.brand, j.modelName].filter(Boolean).join(' ') },
              { k: 'รุ่นย่อย', v: j.modelDetail },
              { k: 'Serial No.', v: j.serial },
              { k: 'IMEI', v: j.imei },
              {
                k: 'การรับประกัน',
                v: j.warranty
                  ? `${j.warranty === 'IN' ? 'ในประกัน' : 'นอกประกัน'}${j.expireDate ? ` (หมดอายุ ${j.expireDate})` : ''}`
                  : '',
              },
              { k: 'ซื้อจากช่องทาง', v: [j.channel, j.shopName].filter(Boolean).join(' · ') },
              { k: 'เลขคำสั่งซื้อ', v: j.so },
              { k: 'วันที่ซื้อ', v: j.saleOrderDate },
              { k: 'รับเข้าโดย', v: j.receptionType },
              { k: 'เลขพัสดุ / ขนส่ง', v: [j.receptionTrackingNo, shipper].filter(Boolean).join(' · ') },
            ]}
          />
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
            <p>
              <span className="text-neutral-500">อุปกรณ์ที่นำส่ง:</span> {j.equipment || '—'}
            </p>
            <p>
              <span className="text-neutral-500">จุดตำหนิ / สภาพภายนอก:</span> {j.fault || '—'}
            </p>
          </div>
        </Box>

        <Box title="อาการเสียที่แจ้ง">
          <p>
            <span className="text-neutral-500">อาการเสียมาตรฐาน:</span>{' '}
            {j.symptoms.length ? j.symptoms.join(', ') : '—'}
          </p>
          <p>
            <span className="text-neutral-500">อาการเสียอื่น ๆ:</span> {j.symptomOther || '—'}
          </p>
          {/* staff's own note (job_remark) — the staff copy only */}
          {!forCustomer && (
            <p className="whitespace-pre-line">
              <span className="text-neutral-500">หมายเหตุ:</span> {j.remark || '—'}
            </p>
          )}
        </Box>

        <Box title="ประเภทงาน / ค่าใช้จ่ายเบื้องต้น">
          <KV
            cols={3}
            items={[
              { k: 'ประเภทงานหลัก', v: j.jobType },
              { k: 'งานย่อย', v: j.jobTypeDetail },
              { k: 'ช่างผู้รับผิดชอบ', v: j.engineer },
              { k: 'ค่าประเมินซ่อม', v: j.estimateCost ? `${money(j.estimateCost)} บาท` : '' },
              { k: 'ค่ามัดจำ', v: j.depositCost ? `${money(j.depositCost)} บาท` : '' },
              { k: 'กำหนดเสร็จโดยประมาณ', v: j.dueDate },
            ]}
          />
        </Box>

        {/* content too long for one sheet moves the terms over with the signatures, never the signatures alone */}
        <div className="break-inside-avoid">
          <Box title="เงื่อนไขการรับซ่อม">
            <ol className="list-decimal space-y-0.5 pl-5 text-[11px]">
              {REPAIR_TERMS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          </Box>

          <p className="mt-1.5">
            {REPAIR_PICKUP_NOTE} *** ลงชื่อผู้รับเครื่องคืน (เขียนตัวบรรจง)
            <span className="ml-1 inline-block w-56 border-b border-dotted border-neutral-500" />
          </p>

          {/* as the legacy slip: the receiving staff's name printed under the line (staff copy only) */}
          <div className="mt-3 grid grid-cols-3 items-end gap-6 text-center">
            {[
              { who: forCustomer ? '' : j.createByName, role: 'พนง.รับเครื่องซ่อม' },
              { who: '', role: 'ลูกค้าแจ้งซ่อม' },
            ].map((s) => (
              <div key={s.role}>
                <div className="mx-auto h-6 w-48 border-b border-dotted border-neutral-500" />
                <p>({s.who || ' '.repeat(24)})</p>
                <p className="text-neutral-500">{s.role}</p>
              </div>
            ))}
            <p className="text-right text-neutral-500">(สำหรับศูนย์บริการ)</p>
          </div>
        </div>
      </div>
    </PrintFrame>
  );
  return forCustomer ? (
    receipt
  ) : (
    <>
      {receipt}
      <ParcelPage j={j} co={co} />
    </>
  );
}

function ParcelPage({ j, co }: { j: JobDetail; co: DocumentProfile }) {
  const c = j.customer;
  const so = j.so.trim();
  return (
    <div className="mt-6 print:mt-0 [page:parcel]">
      {/* the frame is wider than A4's 10mm margins leave: the named page gives it the room. Anything in flow after
          it (the toaster) has another page name, so it would start a blank sheet of its own */}
      <style>{'@page parcel { margin: 0; } @media print { .print-root ~ * { display: none; } }'}</style>
      <ParcelSheet
        profile={co}
        docNo={so ? `(เลขคำสั่งซื้อ : ${so})` : j.no}
        name={c?.name ?? ''}
        address={c?.address ?? ''}
        phone={c?.phone ?? ''}
      />
    </div>
  );
}
