import { AutoPrint } from './auto-print';
import type { DocumentProfile } from '@/server/services/document-profiles';

type ParcelProps = {
  /** ออกเอกสารในนาม — sender block + logo */
  profile: Pick<DocumentProfile, 'code' | 'nameTh' | 'addressLine1' | 'addressLine2' | 'phone' | 'logoUrl'>;
  docNo: string;
  name: string;
  address: string;
  phone: string;
};

/**
 * The parcel address frame on its 210 × 147 mm sheet: the caller's @page decides the paper. The frame grows with the
 * address, past its 92mm only when it must: a parcel with a cut-off address is the worst failure here.
 */
export function ParcelSheet({ profile, docNo, name, address, phone }: ParcelProps) {
  // ponytail: length stands in for measured height; a wrong guess costs a taller frame, never a character
  const chars = name.length + address.length;
  const long = chars > 240;
  const wide = chars > 365;
  return (
    <>
      <style>{`
        .so-sheet { width: 210mm; min-height: 147mm; /* a hair under A5 so rounding never spills a blank 2nd page */ padding-top: 23mm; margin: 0 auto; background: #fff; color: #000; box-shadow: 0 2px 12px rgb(0 0 0 / 0.15); }
        .so-frame { position: relative; margin: 0 5mm; min-height: 92mm; padding-bottom: 3mm; border: 1.5px solid #000; }
        @media print { .so-sheet { box-shadow: none; margin: 0; } }
      `}</style>
      <div className="so-sheet text-[12.5px] leading-[1.35]">
        <div className="so-frame">
          <img src={profile.logoUrl} alt={profile.code} className="absolute left-[4mm] top-[3.5mm] h-[8mm] w-auto" />
          <span className="num absolute right-[6mm] top-[3.5mm] text-[14px]">{docNo}</span>

          {/* in flow: a longer sender pushes the address down instead of running under it */}
          <div className="min-h-[44mm] px-[4.5mm] pt-[15mm] text-[11.5px] leading-[1.35]">
            <p>{profile.nameTh}</p>
            {[profile.addressLine1, profile.addressLine2].filter(Boolean).map((l) => (
              <p key={l}>{l}</p>
            ))}
            <p>โทร.{profile.phone}</p>
          </div>

          {/* past 365 characters the block takes the frame's whole width, below the sender */}
          <div
            className={`leading-[1.35] [overflow-wrap:anywhere] ${wide ? 'mx-[4.5mm]' : 'ml-[60mm] mr-[8mm]'} ${long ? 'text-[11px]' : 'text-[14.5px]'}`}
          >
            <p className="font-bold">กรุณานำส่ง</p>
            <p className={long ? 'mt-[1mm]' : 'mt-[3mm]'}>{name}</p>
            <p className={long ? 'mt-[1mm]' : 'mt-[2mm]'}>{address}</p>
            <p className={long ? 'mt-[1mm]' : 'mt-[2mm]'}>
              โทร.<span className="num">{phone}</span>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

/** A5 landscape, as the legacy "พิมพ์ใบสั่งขาย" sheet; reused for jobs returned by courier. */
export function ShippingLabel(props: ParcelProps) {
  return (
    <main>
      <h1 className="sr-only">ใบปะหน้าพัสดุ {props.docNo}</h1>
      <style>{'@page { size: A5 landscape; margin: 0; }'}</style>
      <div className="mx-auto w-[210mm]">
        <AutoPrint paper="A5 แนวนอน" />
      </div>
      <ParcelSheet {...props} />
    </main>
  );
}
