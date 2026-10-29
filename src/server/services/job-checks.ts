import 'server-only';
import { and, desc, eq, ilike, ne, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { customer, job, manufacturer } from '@/db/schema';
import { cached, TTL_MASTER } from '@/server/cache';
import { likeTerm } from '@/server/paging';
import { RS } from '@/server/record-status';
import { cleanCode } from '@/lib/validation';
import { cleanSerial } from '@/lib/validation/job';

/**
 * Warnings while a job is typed in (never a refusal): the Serial No. already on another job, the Sale Order
 * No. on another customer's job, a Serial that looks like another brand's (or unlike any of this brand's),
 * a shop that sells another brand. The patterns come from the jobs themselves (prod 2026-10: a serial's
 * first 2 characters + its shape name the brand for 77% of jobs, 99.7% of them the brand chosen).
 */

/** brands of one family share serials and shops (MOVA / TROUVER are Dreame's, Soundcore / eufy Anker's …) */
// read from the jobs (prod 2026-10), confirmed by the owner 2026-10-27 — a family column on manufacturer could come later
const FAMILIES = [
  ['dreame', 'mova', 'trouver'],
  ['xiaomi', 'redmi', 'mijia'],
  ['anker', 'soundcore', 'eufy'],
  ['levoit', 'etekcity'],
  ['70mai', 'ddpai', 'vinko'],
];
const nameKey = (b: string) => b.toLowerCase().replace(/[^a-z0-9ก-๙]/g, '');
const FAMILY = new Map(FAMILIES.flatMap((f) => f.map((b) => [b, f[0]!] as const)));
const family = (b: string) => FAMILY.get(nameKey(b)) ?? nameKey(b);

/** a serial's signature: its first 2 characters as typed + the shape of the rest (A = a letter, 9 = a digit) */
export const serialSig = (s: string) => s.slice(0, 2) + '|' + s.slice(2).replace(/[A-Z]/g, 'A').replace(/\d/g, '9');
const REAL_SERIAL = /^(?!0+$)[A-Z0-9][A-Z0-9/._:-]{3,49}$/;
const shopKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9ก-๙]/g, '');

type Count = Map<string, number>;
const add = (m: Map<string, Count>, k: string, b: string) => {
  const c = m.get(k) ?? m.set(k, new Map()).get(k)!;
  c.set(b, (c.get(b) ?? 0) + 1);
};
/** the brand that holds `min`+ jobs of this group and at least `share` of them */
function owner(c: Count | undefined, min: number, share: number): string | null {
  if (!c) return null;
  let n = 0;
  let best: [string, number] = ['', 0];
  for (const e of c) {
    n += e[1];
    if (e[1] > best[1]) best = e;
  }
  return n >= min && best[1] / n >= share ? best[0] : null;
}

type Stats = {
  bySig: Map<string, Count>;
  /** per family: its signatures, its jobs, and whether its top 10 signatures cover 80% of them */
  fam: Map<string, { sigs: Count; total: number; predictable: boolean }>;
  byShop: Map<string, Count>;
};
const stats = () => cached('jobchecks:stats', 5 * TTL_MASTER, loadStats);
async function loadStats(): Promise<Stats> {
  const rows = await db
    .select({ s: job.productSerial, shop: job.productSaleOutShopName, b: manufacturer.manufacturerName })
    .from(job)
    .innerJoin(manufacturer, eq(manufacturer.manufacturerId, job.productBrandId))
    .where(ne(job.recordStatus, RS.DELETED));
  const bySig = new Map<string, Count>();
  const famSigs = new Map<string, Count>();
  const byShop = new Map<string, Count>();
  for (const r of rows) {
    const b = (r.b ?? '').trim();
    if (!b) continue;
    const s = cleanSerial(r.s);
    if (REAL_SERIAL.test(s)) {
      add(bySig, serialSig(s), b);
      add(famSigs, family(b), serialSig(s));
    }
    const k = shopKey(r.shop ?? '');
    if (k.length >= 2) add(byShop, k, b);
  }
  const fam = new Map<string, { sigs: Count; total: number; predictable: boolean }>();
  for (const [f, sigs] of famSigs) {
    const counts = [...sigs.values()].sort((a, b) => b - a);
    const total = counts.reduce((a, b) => a + b, 0);
    const top10 = counts.slice(0, 10).reduce((a, b) => a + b, 0);
    fam.set(f, { sigs, total, predictable: total >= 200 && top10 / total >= 0.8 });
  }
  return { bySig, fam, byShop };
}

/** `id` = job.id (the link), `no` = what is shown */
export type SeenJob = { id: string; no: string; date: string; sameCustomer: boolean; bounce: boolean; model: string };
export type JobChecks = {
  serial: { jobs: SeenJob[]; looksLike: string | null; unusual: boolean };
  so: { jobs: SeenJob[] };
  shop: { brand: string | null };
};

export async function jobChecks(q: {
  serial?: string;
  so?: string;
  brand?: string;
  shop?: string;
  customer?: string;
  job?: string;
}): Promise<JobChecks> {
  const serial = cleanSerial(q.serial);
  const so = cleanCode(q.so);
  const brand = (q.brand ?? '').trim();
  const [custId, st] = await Promise.all([
    q.customer
      ? db
          .select({ id: customer.customerId })
          .from(customer)
          .where(eq(customer.customerCode, q.customer.trim()))
          .then((r) => r[0]?.id ?? null)
      : null,
    stats(),
  ]);
  const seen = async (
    col: typeof job.productSerial | typeof job.jobReferenceNo,
    v: string,
    otherCustomersOnly: boolean,
  ) => {
    const rows = await db
      .select({
        id: job.id,
        no: job.jobNo,
        date: job.jobCreateDate,
        cust: job.customerId,
        bounce: job.isJobBounce,
        model: job.productModelName,
      })
      .from(job)
      .where(
        and(
          ilike(col, likeTerm(v)), // the trigram index finds the few candidates, the next line keeps the equal ones
          sql`upper(btrim(${col})) = ${v}`,
          ne(job.recordStatus, RS.DELETED),
          q.job ? ne(job.jobNo, q.job) : undefined,
          otherCustomersOnly && custId != null ? ne(job.customerId, custId) : undefined,
        ),
      )
      .orderBy(desc(job.jobCreateDate))
      .limit(5);
    return rows.map((r) => ({
      id: r.id,
      no: r.no,
      date: (r.date ?? '').slice(0, 10),
      sameCustomer: custId != null && r.cust === custId,
      bounce: !!r.bounce,
      model: r.model ?? '',
    }));
  };
  const realSerial = REAL_SERIAL.test(serial);
  const [serialJobs, soJobs] = await Promise.all([
    realSerial ? seen(job.productSerial, serial, false) : [],
    // the same order on another customer: one person with two customer codes, or a typo
    so.length >= 4 && !/^0+$/.test(so) && custId != null ? seen(job.jobReferenceNo, so, true) : [],
  ]);

  let looksLike: string | null = null;
  let unusual = false;
  if (realSerial && brand) {
    const sig = serialSig(serial);
    const o = owner(st.bySig.get(sig), 20, 0.95);
    if (o && family(o) !== family(brand)) looksLike = o;
    const f = st.fam.get(family(brand));
    unusual = !looksLike && !!f?.predictable && !f.sigs.has(sig);
  }
  const shopOwner = q.shop && brand ? owner(st.byShop.get(shopKey(q.shop)), 30, 0.9) : null;
  return {
    serial: { jobs: serialJobs, looksLike, unusual },
    so: { jobs: soJobs },
    shop: { brand: shopOwner && family(shopOwner) !== family(brand) ? shopOwner : null },
  };
}
