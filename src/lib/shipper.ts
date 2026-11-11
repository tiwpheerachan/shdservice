/**
 * Which โปรไฟล์บริษัทขนส่ง a courier name typed in the legacy system means — "THAIPOST", "ไปรษณีย์", "EMS",
 * "t" → ไปรษณีย์ไทย. Compared on the profile's code, both names and its `aliases` (comma separated, set on the
 * admin page), ignoring case, spaces, punctuation and Thai tone / vowel marks typed twice or
 * wrong ("ไปรษณ๊ย์", "่j&t"). Shared by the server (/track, print) and the job form's courier dropdown.
 */
export type ShipperNames = { code: string; nameTh: string; nameEn: string; aliases: string };

export function shipperKey(v: string): string {
  return (v ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/ำ/g, 'ํา') // ำ = ํ + า, as "จํากัด" is typed
    .replace(/[ัิ-ฺ็-๎]/g, '') // upper / lower vowels, tone marks, ์
    .replace(/[^a-z0-9฀-๿]/g, ''); // spaces, - . & ( ) …
}

export function shipperFor<P extends ShipperNames>(profiles: readonly P[], typed: string): P | null {
  const k = shipperKey(typed);
  if (!k) return null;
  return (
    profiles.find((p) =>
      [p.code, p.nameTh, p.nameEn, ...(p.aliases ?? '').split(',')].some((n) => shipperKey(n) === k),
    ) ?? null
  );
}
