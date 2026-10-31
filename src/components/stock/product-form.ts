import type { Product } from '@/data/types';

export type ProductForm = {
  mfgCode: string;
  name: string;
  nameEn: string;
  nameCn: string;
  description: string;
  category: string;
  brand: string;
  capitalPrice: string;
  wholesalePrice: string;
  price: string;
  forModelColor: string;
  status: string;
  models: string[];
};

export const EMPTY_PRODUCT_FORM: ProductForm = {
  mfgCode: '',
  name: '',
  nameEn: '',
  nameCn: '',
  description: '',
  category: '',
  brand: '',
  capitalPrice: '',
  wholesalePrice: '',
  price: '',
  forModelColor: '',
  status: 'Active',
  models: [],
};

export const productFormOf = (p: Product & { models?: string[] }): ProductForm => ({
  mfgCode: p.mfgCode,
  name: p.name,
  nameEn: p.nameEn ?? '',
  nameCn: p.nameCn ?? '',
  description: p.description ?? '',
  category: p.category,
  brand: p.brand,
  // a stored 0 shows as 0 (only a new part starts empty); no cost right → no capitalPrice → empty
  capitalPrice: String(p.capitalPrice ?? ''),
  wholesalePrice: String(p.wholesalePrice ?? ''),
  price: String(p.price ?? ''),
  forModelColor: p.forModelColor ?? '',
  status: p.status,
  models: p.models ?? [],
});

type Model = { code: string; name: string; brand: string };

/**
 * รุ่นสินค้า (~1,200): view = only this part's models; edit = ticked ones first, then what the search
 * finds — of the chosen ยี่ห้อ only (`brandOnly`), unless "แสดงทุกยี่ห้อ" is ticked
 */
export function modelRows<M extends Model>(
  models: M[],
  ticked: string[],
  opts: { readOnly: boolean; brandOnly: boolean; brand: string; q: string },
): (M | Model)[] {
  const nameOf = new Map(models.map((m) => [m.code, m]));
  const words = opts.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const own = ticked.map((c) => nameOf.get(c) ?? { code: c, name: '', brand: '' });
  if (opts.readOnly) return own;
  return [
    ...own,
    ...models.filter(
      (m) =>
        !ticked.includes(m.code) &&
        (!opts.brandOnly || m.brand.trim().toLowerCase() === opts.brand.trim().toLowerCase()) &&
        words.every((w) => `${m.code} ${m.name} ${m.brand}`.toLowerCase().includes(w)),
    ),
  ];
}
