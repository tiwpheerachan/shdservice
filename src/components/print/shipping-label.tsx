import { AutoPrint } from "./auto-print";
import type { DocumentProfile } from "@/server/services/document-profiles";

/**
 * ใบปะหน้าพัสดุ A5 แนวนอน — the legacy "พิมพ์ใบสั่งขาย" sheet
 * (setupdata/sales_order/SO2600769_165248.pdf), reused for jobs returned by courier.
 * Framed sheet: SHD logomark, doc no top-right, sender block, "กรุณานำส่ง" + recipient.
 */
export function ShippingLabel({
  profile,
  docNo,
  name,
  address,
  phone,
  subDistrict = "",
  district = "",
  province = "",
}: {
  /** ออกเอกสารในนาม — sender block + logo */
  profile: Pick<DocumentProfile, "code" | "nameTh" | "addressLine1" | "addressLine2" | "phone" | "logoUrl">;
  docNo: string;
  name: string;
  address: string;
  phone: string;
  subDistrict?: string;
  district?: string;
  province?: string;
}) {
  // "ต. อ. จ." — names when the customer master has them, blanks (as the legacy form) when not
  const tao = `ต.${subDistrict ? subDistrict + " " : " "}อ.${district ? district + " " : " "}จ.${province}`;
  return (
    <>
      <style>{`
        @page { size: A5 landscape; margin: 0; }
        .so-sheet { width: 210mm; height: 147mm; /* a hair under A5 so rounding never spills a blank 2nd page */ margin: 0 auto; background: #fff; color: #000; position: relative; box-shadow: 0 2px 12px rgb(0 0 0 / 0.15); }
        .so-frame { position: absolute; left: 5mm; right: 5mm; top: 23mm; height: 92mm; border: 1.5px solid #000; }
        @media print { .so-sheet { box-shadow: none; margin: 0; } }
      `}</style>
      <div className="mx-auto w-[210mm]">
        <AutoPrint />
      </div>
      <div className="so-sheet text-[12.5px] leading-[1.35]">
        <div className="so-frame">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={profile.logoUrl} alt={profile.code} className="absolute left-[4mm] top-[3.5mm] h-[8mm] w-auto" />
          <span className="num absolute right-[6mm] top-[3.5mm] text-[14px]">{docNo}</span>

          <div className="absolute left-[4.5mm] top-[15mm] text-[11.5px] leading-[1.35]">
            <p>{profile.nameTh}</p>
            {[profile.addressLine1, profile.addressLine2].filter(Boolean).map((l) => (
              <p key={l}>{l}</p>
            ))}
            <p>โทร.{profile.phone}</p>
          </div>

          <div className="absolute left-[60mm] right-[8mm] top-[44mm] text-[14.5px] leading-[1.35]">
            <p className="font-bold">กรุณานำส่ง</p>
            <p className="mt-[3mm]">{name}</p>
            <p className="mt-[2mm]">{address}</p>
            <p className="mt-[2mm]">{tao}</p>
            <p className="mt-[2mm]">โทร.<span className="num">{phone}</span></p>
          </div>
        </div>
      </div>
    </>
  );
}
