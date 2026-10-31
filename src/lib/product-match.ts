import type { Product } from '@/data/types';

/** The fields the picker needs — the lite product rows (useProductSearch / useProducts) carry them. */
export type PickableProduct = Pick<
  Product,
  'sysCode' | 'mfgCode' | 'name' | 'nameEn' | 'nameCn' | 'onhand' | 'price' | 'brand' | 'category'
>;

export const MAX_ROWS = 60;

/**
 * Word search over code / vendor part no / name (TH/EN/CN) / brand / category: every typed
 * word must appear somewhere (any order), exact code or part-no matches first,
 * then code prefix, then name prefix, then the rest in code order.
 */
export function matchProducts<T extends PickableProduct>(products: T[], q: string, limit = MAX_ROWS): T[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return products.slice(0, limit);
  const full = words.join(' ');
  const scored: { p: T; s: number }[] = [];
  for (const p of products) {
    const code = p.sysCode.toLowerCase();
    const mfg = (p.mfgCode ?? '').toLowerCase();
    const name = p.name.toLowerCase();
    const hay = `${code} ${mfg} ${name} ${(p.nameEn ?? '').toLowerCase()} ${(p.nameCn ?? '').toLowerCase()} ${(p.brand ?? '').toLowerCase()} ${(p.category ?? '').toLowerCase()}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const s =
      code === full || mfg === full
        ? 0
        : code.startsWith(full) || mfg.startsWith(full)
          ? 1
          : name.startsWith(full)
            ? 2
            : 3;
    scored.push({ p, s });
  }
  scored.sort((a, b) => a.s - b.s);
  return scored.slice(0, limit).map((x) => x.p);
}
