import qrcode from "qrcode-generator";

/**
 * QR that takes the customer to /t/<token> — printed on the quotation, the one
 * document the customer actually receives. Rendered as inline SVG so the print
 * page needs no network and no client JS.
 */
export function TrackQr({ url, size = 56, label = "สแกนเพื่อติดตามสถานะงานซ่อม" }: { url: string; size?: number; label?: string }) {
  if (!url) return null;
  const qr = qrcode(0, "M"); // type 0 = auto-fit, error correction M
  qr.addData(url);
  qr.make();
  const count = qr.getModuleCount();
  const cells: string[] = [];
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) cells.push(`M${c},${r}h1v1h-1z`);
    }
  }
  return (
    <div className="flex items-start gap-2">
      <svg
        viewBox={`0 0 ${count} ${count}`}
        width={size}
        height={size}
        shapeRendering="crispEdges"
        role="img"
        aria-label={label}
        style={{ display: "block" }}
      >
        <rect width={count} height={count} fill="#fff" />
        <path d={cells.join("")} fill="#000" />
      </svg>
      <p className="max-w-[120px] text-[8.5px] leading-[1.35]">{label}</p>
    </div>
  );
}
