/** จำนวนเงิน → คำอ่านภาษาไทย เช่น 1400 → "หนึ่งพันสี่ร้อยบาทถ้วน", 20.50 → "ยี่สิบบาทห้าสิบสตางค์" */
const DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const PLACES = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

function readGroup(n: number, hasHigher = false): string {
  // n < 1,000,000; hasHigher = a "ล้าน" group precedes this one (so a lone 1 reads เอ็ด)
  let out = "";
  const s = String(n);
  const len = s.length;
  for (let i = 0; i < len; i++) {
    const d = Number(s[i]);
    const pos = len - i - 1; // 0 = units
    if (d === 0) continue;
    if (pos === 0 && d === 1 && (len > 1 || hasHigher)) out += "เอ็ด";
    else if (pos === 1 && d === 2) out += "ยี่สิบ";
    else if (pos === 1 && d === 1) out += "สิบ";
    else out += DIGITS[d] + PLACES[pos];
  }
  return out;
}

function readInt(n: number): string {
  if (n === 0) return DIGITS[0];
  let out = "";
  let rest = n;
  const parts: number[] = [];
  while (rest > 0) { parts.unshift(rest % 1_000_000); rest = Math.floor(rest / 1_000_000); }
  parts.forEach((p, i) => {
    if (p === 0 && i < parts.length - 1) return;
    let g = readGroup(p, i > 0);
    // "หนึ่งล้าน" not "เอ็ดล้าน" when the group is exactly 1 and not the last group
    if (p === 1 && parts.length > 1 && i < parts.length - 1) g = "หนึ่ง";
    out += g + (i < parts.length - 1 ? "ล้าน" : "");
  });
  return out;
}

export function bahtText(amount: number): string {
  const abs = Math.abs(amount);
  const baht = Math.floor(abs + 1e-9);
  const satang = Math.round((abs - baht) * 100) % 100;
  let out = (amount < 0 ? "ลบ" : "") + readInt(baht) + "บาท";
  out += satang > 0 ? readGroup(satang) + "สตางค์" : "ถ้วน";
  return out;
}
