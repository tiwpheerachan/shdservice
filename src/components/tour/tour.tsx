'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { GraduationCap, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useAccess } from '@/lib/use-access';
import { postJson } from '@/lib/api';
import { TOURS, type Step, type StepCtx, type Text } from './tours';

/**
 * บทสอนการใช้งานทีละขั้น (แบบ tutorial ในเกม) — ช่องของขั้นนั้นสว่างทีละช่อง (กรอบต่อช่อง) ที่เหลือของหน้ามืดและกดไม่ได้
 * · ปุ่ม ? ที่แถบบนเริ่มบทสอนของหน้านั้น · เข้าหน้าครั้งแรกถามก่อนหนึ่งครั้ง
 * · ช่องที่สว่างลองพิมพ์/เลือกได้ (สว่าง = ใช้ได้, ใช้ได้ = สว่าง) · ปุ่มบนหน้า (บันทึก แนบไฟล์ …) กดไม่ได้ → ไม่บันทึกจริง
 * · จบแล้วฟอร์มกลับเป็นเหมือนก่อนเริ่ม (ฟอร์มที่ส่ง snapshot/restore มาด้วย useTourRestore — ฟอร์มที่เปิดขึ้น
 *   ระหว่างบทสอน เช่นในหน้าต่างเพิ่ม/แก้ไข ก็กลับเป็นแบบตอนเปิด)
 * · ขั้นที่ไม่เจอเป้าหมาย (ไม่มีสิทธิ์ / ไม่แสดงบนจอนี้ / ไม่มีข้อมูลนั้น) ถูกข้ามเอง · `show` = ขั้นตามสถานะหน้า
 * · ขั้นในหน้าต่าง (`dialog`): บทสอนกดเปิดให้ แล้วปิดคืนตอนออกจากขั้นเหล่านั้น — การ์ดอยู่ในหน้าต่างนั้น
 * · ถามแล้ว / ไม่ต้องถามอีก เก็บต่อบัญชี (drizzle/0039, POST /api/me/tour)
 */

type Ctx = { has: boolean; start: () => void };
const TourCtx = React.createContext<Ctx>({ has: false, start: () => {} });
export const useTour = () => React.useContext(TourCtx);

type Draft = { snap: () => unknown; restore: (v: never) => void };
type FormHook = { current: Draft };
/** every part of the page that holds a draft (the job form, the customer picker's ลูกค้าใหม่ …) */
const forms = new Set<FormHook>();
/** while a tour runs: each draft as it was before it (or when it mounted — a dialog's form opened by the tour) */
let before: Map<FormHook, string> | null = null;
/** something was typed / picked during the tour: only then is "the form is back" worth saying */
let tried = false;
/** put back every draft the tour changed; true when one was */
function restoreDrafts(): boolean {
  let restored = false;
  before?.forEach((was, h) => {
    if (!forms.has(h) || JSON.stringify(h.current.snap()) === was) return;
    h.current.restore(JSON.parse(was) as never);
    restored = true;
  });
  return restored;
}
/** this draft as it is now / put it back — what was tried during the tour goes, what was there stays */
export function useTourRestore<T>(snap: () => T, restore: (v: T) => void) {
  const latest = React.useRef<Draft>({ snap, restore: restore as (v: never) => void });
  React.useLayoutEffect(() => {
    latest.current = { snap, restore: restore as (v: never) => void };
  });
  React.useEffect(() => {
    forms.add(latest);
    if (before && !before.has(latest)) before.set(latest, JSON.stringify(latest.current.snap()));
    return () => {
      forms.delete(latest);
    };
  }, []);
}

const norm = (s: string | null) =>
  (s ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^\*/, '')
    .replace(/\(จำเป็น\)$/, '')
    .trim();
/** on the screen and usable: a folded filter bar keeps its fields' boxes but makes them `inert` (clipped) */
const shown = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && !el.closest('[inert]');
};

/** an open modal dialog (portaled out of <main>) — a popover's own role=dialog is not one */
const DIALOG =
  '[role="dialog"][data-state="open"]:not([data-radix-popper-content-wrapper] *), [role="alertdialog"][data-state="open"]';
const openDialog = () => [...document.querySelectorAll<HTMLElement>(DIALOG)].at(-1) ?? null;
/** where targets are looked for: the open dialog, else the page */
const scope = (): ParentNode => openDialog() ?? document.querySelector('main') ?? document;

/** `field:<label>|<label>` (each field) · `body:<section heading>` (the section without its heading) ·
 *  `button:<text>` · or a CSS selector — the visible matches, in page order (in the open dialog, if one is) */
export function find(target: string): HTMLElement[] {
  const m = /^(body|field|button):(.*)$/.exec(target);
  if (!m) return [...document.querySelectorAll<HTMLElement>(target)].filter(shown).slice(0, 1);
  const [, kind, arg = ''] = m;
  const root = scope();
  if (kind === 'body') {
    const s = [...root.querySelectorAll<HTMLElement>('section')].find(
      (el) => norm(el.querySelector('h2')?.textContent ?? null) === arg,
    );
    const b = s?.querySelector<HTMLElement>(':scope > header + div');
    return b && shown(b) ? [b] : [];
  }
  if (kind === 'button') {
    const b = [...root.querySelectorAll<HTMLElement>('button, a')].find(
      (el) => shown(el) && norm(el.textContent) === arg,
    );
    return b ? [b] : [];
  }
  const names = arg.split('|');
  return [...root.querySelectorAll<HTMLLabelElement>('label')]
    .filter((l) => names.includes(norm(l.textContent)))
    .map((l) => l.parentElement!)
    .filter(shown);
}

type Box = { l: number; t: number; r: number; b: number };
/** the part of `el` that can be seen: cut to every box around it that clips (a dialog's scrolling body, a wide table) */
const box = (el: Element, pad = 0): Box => {
  const r = el.getBoundingClientRect();
  const b = { l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad };
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const c = p.getBoundingClientRect();
    b.l = Math.max(b.l, c.left);
    b.t = Math.max(b.t, c.top);
    b.r = Math.min(b.r, c.right);
    b.b = Math.min(b.b, c.bottom);
  }
  return b.r > b.l && b.b > b.t ? b : { l: b.l, t: b.t, r: b.l, b: b.t };
};
const union = (bs: Box[]): Box => ({
  l: Math.min(...bs.map((b) => b.l)),
  t: Math.min(...bs.map((b) => b.t)),
  r: Math.max(...bs.map((b) => b.r)),
  b: Math.max(...bs.map((b) => b.b)),
});
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
/** a rounded rectangle as an SVG path */
const rounded = ({ l, t, r, b }: Box, rad = 8) =>
  `M${l + rad} ${t}H${r - rad}A${rad} ${rad} 0 0 1 ${r} ${t + rad}V${b - rad}A${rad} ${rad} 0 0 1 ${r - rad} ${b}` +
  `H${l + rad}A${rad} ${rad} 0 0 1 ${l} ${b - rad}V${t + rad}A${rad} ${rad} 0 0 1 ${l + rad} ${t}Z`;
/** the nearest box around `el` that scrolls up and down on its own (a dialog's body), if any */
const scroller = (el: Element): HTMLElement | null => {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement)
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
  return null;
};
/** on the screen whatever the scroll (the sticky save bar, the topbar): never scrolled to */
const pinned = (el: Element | null): boolean => {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    const p = getComputedStyle(e).position;
    if (p === 'fixed' || p === 'sticky') return true;
  }
  return false;
};

/** what can be typed into / ticked / chosen in a lit field — its own buttons too (a checkbox, ★, ×);
 *  never a file input (the OS chooser), a read-only one (a view-only role), nor a data-tour-block button (it saves) */
const TYPABLE =
  ':is(input:not([type="file"]):not([type="hidden"]):not([readonly]), textarea:not([readonly]), select, button):not(:disabled):not([aria-readonly="true"]):not([data-tour-block])';
/** an open dropdown of a lit field (Radix popovers are portaled to <body>) */
const PICKER = '[data-radix-popper-content-wrapper], [role="listbox"]';
/** what can be used in a lit field — the field itself when it is the control (a filter's combobox) */
const controls = (e: Element) => [...(e.matches(TYPABLE) ? [e] : []), ...e.querySelectorAll(TYPABLE)] as HTMLElement[];
/** a confirmation the page asks (ออกโดยไม่บันทึก? / มอบให้คนใหม่แทน?): answered as usual — the write guard holds */
const ASK = '[role="alertdialog"]';
const PAD = 4;

function Runner({
  steps,
  title,
  ctx,
  onEnd,
}: {
  steps: Step[];
  title: string;
  ctx: StepCtx;
  onEnd: (done: boolean) => void;
}) {
  const [i, setI] = React.useState(0);
  const holes = React.useRef<SVGPathElement>(null);
  const rings = React.useRef<SVGPathElement>(null);
  const glow = React.useRef<SVGPathElement>(null);
  const card = React.useRef<HTMLDivElement>(null);
  const next = React.useRef<HTMLButtonElement>(null);
  /** the full text asked for on a card that is shown small (a short screen / no room) — for the whole tour */
  const expanded = React.useRef(false);
  /** the small card's height (the last time it was shown small): what a field scrolled to the top keeps clear of */
  const compactH = React.useRef(70);
  /** something was typed / picked: the last card says the form goes back */
  const [triedHere, setTriedHere] = React.useState(tried);
  const step = steps[i]!;
  const last = i === steps.length - 1;
  // a target that is not there yet (a dialog opening) is looked for again for a moment
  const [tick, setTick] = React.useState(0);
  // a dialog step looks only once its dialog is open: before, the page may hold fields of the same name (a filter bar)
  const els = React.useMemo(
    () => (step.target && tick >= 0 && (!step.dialog || openDialog()) ? find(step.target) : []),
    [step, tick],
  );
  React.useEffect(() => {
    if (!step.target || els.length || tick > 40) return;
    const t = setTimeout(() => setTick((n) => n + 1), 50);
    return () => clearTimeout(t);
  }, [step, els, tick]);

  // the tour's own presses (open / close a dialog) pass the click guard below
  const bypass = React.useRef(false);
  const press = React.useCallback((el: HTMLElement | null | undefined) => {
    bypass.current = true;
    try {
      el?.click();
    } finally {
      bypass.current = false;
    }
  }, []);
  // a dialog step: opened by the tour, closed again (what was typed in it put back first) when the tour leaves it
  const shownDialog = React.useRef<Step['dialog'] | null>(null);
  const closeDialog = React.useCallback(
    (d: NonNullable<Step['dialog']>) => {
      restoreDrafts();
      press(d.close ? find(d.close)[0] : openDialog()?.querySelector<HTMLElement>('[aria-label="ปิด"]'));
    },
    [press],
  );
  React.useEffect(() => {
    const want = step.dialog;
    const cur = shownDialog.current;
    if (cur && cur.open !== want?.open) {
      closeDialog(cur);
      shownDialog.current = null;
    }
    if (want && !shownDialog.current) {
      if (!openDialog()) press(find(want.open)[0]);
      shownDialog.current = want;
    }
  }, [step, press, closeDialog]);
  React.useEffect(
    () => () => {
      if (shownDialog.current) closeDialog(shownDialog.current);
    },
    [closeDialog],
  );
  // inside a dialog the tour's own UI lives in it: the dialog keeps the focus and the clicks to itself
  const host = step.dialog && els.length ? els[0]!.closest<HTMLElement>(DIALOG) : null;
  const tryIt = !step.look && els.some((e) => controls(e).length > 0);
  // lit fields that could be used but not in this step (a filter that searches at once): said on the card
  const lookOnly =
    !!step.look &&
    els.some(
      (e) =>
        !!e.querySelector(
          ':is(input:not([type="file"]):not([type="hidden"]):not([readonly]), select, textarea):not(:disabled)',
        ),
    );
  const text = (t: Text | undefined) => (typeof t === 'function' ? t(ctx) : t);

  const go = React.useCallback((d: number) => setI((n) => Math.min(Math.max(n + d, 0), steps.length - 1)), [steps]);

  // nothing a tour does is saved — whatever the page tries: every write the page sends is refused while it runs
  // (its own "asked already" excepted). The click / key guard below is the first line; this one holds if it misses
  React.useEffect(() => {
    const fetch0 = window.fetch;
    // said in the console: the e2e fails a tour that let the page try (the guard above should have stopped it)
    const refused = (method: string, url: string) => {
      console.warn(`[tour] refused ${method} ${url}`);
      return Promise.reject(new Error('ระหว่างบทสอน ระบบไม่บันทึกข้อมูล'));
    };
    const isWrite = (method: string | undefined, url: string) =>
      !!method && !/^(GET|HEAD)$/i.test(method) && !url.includes('/api/me/tour');
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      return isWrite(method, url) ? refused(method, url) : fetch0(input, init);
    };
    const open0 = XMLHttpRequest.prototype.open;
    const send0 = XMLHttpRequest.prototype.send;
    const writes = new WeakSet<XMLHttpRequest>();
    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      if (isWrite(method, String(url))) {
        writes.add(this);
        console.warn(`[tour] refused ${method} ${String(url)}`);
      }
      return (open0 as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      if (writes.has(this)) {
        this.abort();
        return;
      }
      return send0.call(this, body);
    };
    return () => {
      window.fetch = fetch0;
      XMLHttpRequest.prototype.open = open0;
      XMLHttpRequest.prototype.send = send0;
    };
  }, []);

  // the lit fields carry a mark (the e2e checks them) and the page knows a tour runs (dropdowns above the dim)
  React.useEffect(() => {
    document.documentElement.dataset.tour = tryIt ? 'try' : '';
    els.forEach((e) => (e.dataset.tourTarget = ''));
    return () => {
      delete document.documentElement.dataset.tour;
      els.forEach((e) => delete e.dataset.tourTarget);
    };
  }, [els, tryIt]);

  // the step's fields into the upper part of the screen — on a step change and after a resize / rotation
  const toEnd = !!step.toEnd;
  React.useEffect(() => {
    const bring = () => {
      if (!els.length) return;
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // a wide table the card talks about the last column of: its scroll box sideways to it (at once — the
      // scrollIntoView below would cancel a smooth one); the lit part may be the header row inside it
      if (toEnd) (els[0]!.closest<HTMLElement>('.table-scroll') ?? els[0]!).scrollTo({ left: els[0]!.scrollWidth });
      // inside a box that scrolls on its own (a dialog's body): the step's fields to its top, all of them that fit;
      // a table wider than a phone: sideways to the first one — the page itself is placed below
      const sc = scroller(els[0]!);
      if (sc) {
        const c = sc.getBoundingClientRect();
        const top = Math.min(...els.map((e) => e.getBoundingClientRect().top));
        const bottom = Math.max(...els.map((e) => e.getBoundingClientRect().bottom));
        if (top < c.top || bottom > c.bottom) sc.scrollTop += top - c.top - 8;
      }
      els[0]!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (els.some(pinned)) return;
      const u = union(els.map((e) => box(e)));
      const vh = window.innerHeight;
      if (u.t < 64 || u.t + Math.min(u.b - u.t, vh * 0.45) > vh * 0.6) {
        // a short screen: below the small card when that goes to the top (its own height: it wraps when narrow)
        const at = vh < 500 ? Math.max(64, compactH.current + 24) : Math.max(72, vh * 0.15);
        window.scrollBy({ top: u.t - at, behavior: smooth ? 'smooth' : 'auto' });
      }
    };
    bring();
    next.current?.focus({ preventScroll: true });
    let t = 0;
    const onResize = () => {
      clearTimeout(t);
      t = window.setTimeout(bring, 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', onResize);
    };
  }, [els, toEnd]);

  // follow the fields every frame (scroll, a field that grows, a dropdown that opens) — no CSS transition:
  // the ring stays on the field
  React.useEffect(() => {
    let raf = 0;
    let full = { w: 0, h: 0 }; // the full card's size, measured while it is shown full
    const seenOpen = new WeakSet<Element>();
    const place = () => {
      const c = card.current;
      if (c && holes.current && rings.current && glow.current) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const lit = els.filter(shown).map((e) => box(e, PAD));
        const openEls = els.length
          ? [...document.querySelectorAll<HTMLElement>(PICKER)].filter(
              (p) => shown(p) && (p.matches('[data-radix-popper-content-wrapper]') || els.some((e) => e.contains(p))),
            )
          : [];
        // a dropdown that opened past the screen's edge (a phone on its side: no room above or below its field):
        // its field to the top once, so the list opens below it with its search box in view
        for (const p of openEls) {
          if (seenOpen.has(p)) continue;
          seenOpen.add(p);
          const r = p.getBoundingClientRect();
          const field = els.find((e) => e.querySelector('[aria-expanded="true"]'));
          // a short screen: clear of the small card at the top edge (it is see-through while the list is open)
          const at = vh < 500 && c.hasAttribute('data-compact') ? Math.max(64, c.offsetHeight + 24) : 64;
          if (field && (r.top < 0 || r.bottom > vh)) window.scrollBy(0, field.getBoundingClientRect().top - at);
        }
        const open = openEls.map((p) => box(p, PAD));
        const ring = lit.map((b) => rounded(b)).join('');
        holes.current.setAttribute('d', ring + open.map((b) => rounded(b)).join(''));
        rings.current.setAttribute('d', ring);
        glow.current.setAttribute('d', ring);

        // the card: where it covers none of the lit fields / the open dropdown, else where it covers least.
        // Shown small (title + buttons) when the full card fits nowhere clear, or on a short screen
        // (a phone on its side) — decided from the full card's size, so it never flips back and forth
        if (!c.hasAttribute('data-compact')) full = { w: c.offsetWidth, h: c.offsetHeight };
        const all = [...lit, ...open];
        const short = vh < 500;
        // a dialog step: the dialog's own title row stays readable too (placement only — never lit)
        const dlg = step.dialog ? openDialog() : null;
        const heading = dlg && document.getElementById(dlg.getAttribute('aria-labelledby') ?? '');
        const head = dlg && heading ? [...dlg.children].find((ch) => ch.contains(heading)) : undefined;
        const avoid = head ? [box(head)] : [];
        const best = ({ w: cw, h: ch }: { w: number; h: number }) => {
          const clampX = (x: number) => Math.min(Math.max(x, 8), vw - cw - 8);
          const clampY = (y: number) => Math.min(Math.max(y, 8), vh - ch - 8);
          let spots: [number, number][];
          if (!all.length) spots = [[(vw - cw) / 2, (vh - ch) / 2]];
          else if (vw < 640 || short)
            // a phone (or a short screen): the bottom edge, or the top one when the fields are down there
            spots = [
              [(vw - cw) / 2, vh - ch - 12],
              [(vw - cw) / 2, 64],
              [(vw - cw) / 2, 8],
            ];
          else {
            const u = union(all);
            const gap = 12;
            spots = [
              [u.l, u.b + gap],
              [u.l, u.t - gap - ch],
              [u.r + gap, u.t],
              [u.l - gap - cw, u.t],
              [u.l, vh - ch - 16],
              [u.l, 64],
            ];
          }
          const cost = ([x, y]: [number, number], hs = all) => {
            const b = { l: x, t: y, r: x + cw, b: y + ch };
            return hs.reduce((n, h) => n + overlap(b, h), 0);
          };
          const placed = spots.map(([x, y]): [number, number] => [clampX(x), clampY(y)]);
          const pick =
            placed.find((p) => cost(p) === 0 && cost(p, avoid) === 0) ??
            placed.find((p) => cost(p) === 0) ??
            placed.reduce((q, p) => (cost(p) < cost(q) ? p : q));
          return { at: pick, clear: cost(pick) === 0 };
        };
        const asFull = best(full);
        // from sizes, not from where the fields are right now (mid-scroll): no flash on a step change, no
        // flip while scrolling — too tall to share the screen with the full card and no room beside them
        const u = all.length ? union(all) : null;
        const beside = !!u && (vw - u.r > full.w + 24 || u.l > full.w + 24);
        const tall = !!u && !beside && u.b - u.t + full.h + 40 > vh - 64;
        // or nowhere for the full card that keeps clear of them (a dialog filling a phone, an open dropdown)
        const small = all.length > 0 && (short || tall || !asFull.clear);
        c.toggleAttribute('data-small', small); // "อ่านคำอธิบาย" / "ย่อคำอธิบาย" are offered
        c.toggleAttribute('data-compact', small && !expanded.current);
        if (small && !expanded.current) compactH.current = c.offsetHeight;
        // a short screen with a lit field's list open: the card steps aside, see-through, until it closes
        c.toggleAttribute('data-ghost', short && open.length > 0);
        const { at } = small && !expanded.current ? best({ w: c.offsetWidth, h: c.offsetHeight }) : asFull;
        c.style.left = `${at[0]}px`;
        c.style.top = `${at[1]}px`;
      }
      // a dialog step whose dialog the page closed (its own action ran): the card went with it — end, never a
      // page left locked with nothing on it
      if (step.dialog && els.length && !els[0]!.isConnected) return onEnd(false);
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [els, step, onEnd]);

  // nothing outside the card and the lit fields takes a click, a key or the focus
  React.useEffect(() => {
    const inLit = (t: Element) => tryIt && (els.some((e) => e.contains(t)) || !!t.closest(PICKER));
    const allowed = (t: EventTarget | null) => {
      if (!(t instanceof Element)) return false;
      if (card.current?.contains(t) || t.closest(ASK)) return true;
      if (!inLit(t)) return false;
      if (t.closest('input[type="file"], [data-tour-block]') || t.closest('label')?.querySelector('input[type="file"]'))
        return false;
      const b = t.closest('button, a');
      if (!b || b.closest(PICKER)) return true;
      // a link leaves the page; a data-tour-block button saves — the field's other buttons are its own
      return b.tagName === 'BUTTON' && !b.matches('[data-tour-block]');
    };
    const block = (e: Event) => {
      if (bypass.current || allowed(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    /** Tab goes round the lit fields then the card's buttons, in reading order */
    const cycle = (back: boolean) => {
      const own = tryIt ? els.flatMap(controls).filter((x) => shown(x) && x.tabIndex >= 0) : [];
      const buttons = card.current ? [...card.current.querySelectorAll<HTMLElement>('button')].filter(shown) : [];
      const list = [...own, ...buttons];
      const at = list.indexOf(document.activeElement as HTMLElement);
      const to = at < 0 ? 0 : (at + (back ? -1 : 1) + list.length) % list.length;
      list[to]?.focus();
    };
    const key = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest(ASK)) return; // its own Tab / Esc / Enter
      const inPicker = !!t?.closest(PICKER) || !!document.querySelector('[data-radix-popper-content-wrapper]');
      if (e.key === 'Escape') {
        if (inPicker) return; // closes the dropdown only
        e.preventDefault();
        e.stopPropagation();
        onEnd(false);
        return;
      }
      if (e.key === 'Tab') {
        if (t?.closest(PICKER)) return;
        e.preventDefault();
        e.stopPropagation();
        cycle(e.shiftKey);
        return;
      }
      const typing = !!t && inLit(t) && !card.current?.contains(t);
      // Enter in a lit box runs the page's action (เพิ่มตำแหน่ง closes its dialog, a filter searches) — not in a
      // tour; an open suggestion list's own Enter (picks the item) still works
      if (
        typing &&
        e.key === 'Enter' &&
        t.matches('input') &&
        t.getAttribute('aria-expanded') !== 'true' &&
        !inPicker
      ) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // shortcuts (⌘K menu, Ctrl+S …) never reach the page; copy / paste / undo inside a lit field do
      if ((e.ctrlKey || e.metaKey || e.altKey) && !(typing && /^[acvxyz]$/i.test(e.key))) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (t && card.current?.contains(t)) {
        if (e.key === 'ArrowRight') go(1);
        if (e.key === 'ArrowLeft') go(-1);
        return;
      }
      if (!typing) block(e);
    };
    const kinds = ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'submit'];
    const changed = (e: Event) => {
      if (!(e.target instanceof Element) || !inLit(e.target)) return;
      tried = true;
      setTriedHere(true);
    };
    kinds.forEach((k) => window.addEventListener(k, block, true));
    window.addEventListener('keydown', key, true);
    window.addEventListener('input', changed, true);
    window.addEventListener('change', changed, true);
    return () => {
      kinds.forEach((k) => window.removeEventListener(k, block, true));
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('input', changed, true);
      window.removeEventListener('change', changed, true);
    };
  }, [els, tryIt, go, onEnd]);

  const stepTitle = text(step.title) ?? '';
  const required = stepTitle.endsWith(' *');
  const titleText = required ? stepTitle.slice(0, -2) : stepTitle;
  const example = text(step.example);
  const ui = (
    <>
      <svg aria-hidden className="pointer-events-none fixed inset-0 z-70 h-full w-full">
        <defs>
          <mask id="tour-holes">
            <rect width="100%" height="100%" fill="white" />
            <path ref={holes} fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" mask="url(#tour-holes)" className="fill-black/55 dark:fill-black/75" />
        <path ref={glow} fill="none" strokeWidth={8} className="stroke-primary/25" />
        <path ref={rings} fill="none" strokeWidth={2} className="stroke-primary" />
      </svg>
      <p aria-live="polite" className="sr-only">
        {`ขั้นที่ ${i + 1} จาก ${steps.length}: ${titleText}${required ? ' (จำเป็น)' : ''}`}
      </p>
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="group pointer-events-auto fixed z-71 w-[min(400px,calc(100vw-24px))] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-pop dark:border-primary/30 data-compact:flex data-compact:w-[min(720px,calc(100vw-24px))] data-compact:flex-wrap data-compact:items-center data-compact:gap-x-4 data-compact:gap-y-2 data-compact:p-3 transition-opacity data-ghost:pointer-events-none data-ghost:opacity-20"
      >
        {/* small (a short screen / no room): one line — title, step count, อ่านคำอธิบาย — and the buttons */}
        <div className="group-data-compact:hidden">
          <div className="flex items-center justify-between gap-2 text-2xs text-muted-foreground">
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
              <GraduationCap className="h-3.5 w-3.5 shrink-0 text-primary" />
              บทสอน · {title}
            </span>
            <span className="num shrink-0">
              {i + 1} / {steps.length}
            </span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-primary" style={{ width: `${((i + 1) / steps.length) * 100}%` }} />
          </div>
        </div>
        <div className="mt-3 flex min-w-0 flex-wrap items-baseline gap-x-2 group-data-compact:mt-0 group-data-compact:flex-1">
          <h2 id="tour-title" className="min-w-0 text-base font-semibold">
            {titleText}
            {required && (
              <>
                {' '}
                <span aria-hidden className="text-danger">
                  *
                </span>
                <span className="sr-only">(จำเป็น)</span>
              </>
            )}
          </h2>
          <span aria-hidden className="num hidden text-2xs text-muted-foreground group-data-compact:inline">
            {i + 1} / {steps.length}
          </span>
          <button
            type="button"
            onClick={() => (expanded.current = true)}
            className="hidden text-xs font-medium text-primary underline-offset-4 hover:underline group-data-compact:inline"
          >
            อ่านคำอธิบาย
          </button>
        </div>
        <div className="group-data-compact:hidden">
          <p id="tour-body" className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {text(step.body)}
          </p>
          {example && (
            <p className="mt-2 rounded-md bg-muted px-2.5 py-1.5 text-xs">
              ตัวอย่าง: <span className="font-medium text-foreground">{example}</span>
            </p>
          )}
          {tryIt ? (
            <p className="mt-2 text-2xs text-primary">
              ลองพิมพ์ / เลือกในช่องที่สว่างได้ — จบบทสอนแล้วฟอร์มกลับเป็นเหมือนเดิม
            </p>
          ) : (
            lookOnly && <p className="mt-2 text-2xs text-muted-foreground">ขั้นนี้ดูอย่างเดียว ลองใช้ได้หลังจบบทสอน</p>
          )}
          {last && triedHere && !tryIt && <p className="mt-2 text-2xs text-primary">จบแล้วฟอร์มกลับเป็นเหมือนเดิม</p>}
          <button
            type="button"
            onClick={() => (expanded.current = false)}
            className="mt-1 hidden text-xs font-medium text-primary underline-offset-4 hover:underline group-data-small:inline"
          >
            ย่อคำอธิบาย
          </button>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2 group-data-compact:mt-0 group-data-compact:ml-auto">
          {last ? (
            <span />
          ) : (
            <Button variant="ghost" size="sm" onClick={() => onEnd(false)}>
              ข้ามบทสอน
            </Button>
          )}
          <div className="flex gap-2">
            {i > 0 && (
              <Button variant="outline" size="sm" onClick={() => go(-1)}>
                ก่อนหน้า
              </Button>
            )}
            <Button ref={next} size="sm" onClick={() => (last ? onEnd(true) : go(1))}>
              {last ? 'เสร็จสิ้น' : i === 0 ? 'เริ่มเลย' : 'ถัดไป'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
  return host ? createPortal(ui, host) : ui;
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { can, tour: asked } = useAccess();
  const { push } = useToast();
  const tour = TOURS[path];
  // what this account was asked already (from the page) + what it answers here
  const [seen, setSeen] = React.useState(() => new Set(asked?.seen ?? []));
  const [off, setOff] = React.useState(asked?.off ?? false);
  const remember = React.useCallback((change: { seen?: string; off?: boolean }) => {
    if (change.seen) setSeen((v) => new Set(v).add(change.seen!));
    if (change.off) setOff(true);
    postJson('/api/me/tour', change).catch(() => undefined); // a nicety: lost = asked again next time
  }, []);
  // both belong to the page they were made on: another page starts with neither
  const [running, setRun] = React.useState<{ path: string; steps: Step[] } | null>(null);
  const run = running?.path === path ? running : null;
  const [offerPath, setOfferPath] = React.useState<string | null>(null);
  const offer = offerPath === path;
  const ctx = React.useMemo<StepCtx>(() => ({ can, has: (t) => find(t).length > 0 }), [can]);

  const start = React.useCallback(() => {
    if (!tour) return;
    setOfferPath(null);
    if (!seen.has(path)) remember({ seen: path });
    before = new Map([...forms].map((h) => [h, JSON.stringify(h.current.snap())]));
    tried = false;
    // the steps this user sees on this screen now (no right / hidden here / not this state of the page → left out);
    // a dialog step counts when what opens the dialog is there
    const pick = () =>
      setRun({
        path,
        steps: tour.steps.filter(
          (s) =>
            (!s.show || s.show(ctx)) &&
            (s.dialog ? find(s.dialog.open).length > 0 : !s.target || find(s.target).length > 0),
        ),
      });
    // the tab most steps are on, opened first (its fields render on the next frames)
    const tab = tour.prepare ? find(tour.prepare)[0] : undefined;
    if (tab && tab.getAttribute('aria-selected') !== 'true') {
      // a Radix tab switches on mousedown, not on click
      for (const k of ['mousedown', 'mouseup', 'click'])
        tab.dispatchEvent(new MouseEvent(k, { bubbles: true, cancelable: true, button: 0 }));
      setTimeout(pick, 80);
    } else pick();
  }, [tour, path, seen, remember, ctx]);

  const end = React.useCallback(
    (done: boolean) => {
      const restored = restoreDrafts() && tried;
      before = null;
      tried = false;
      setRun(null);
      // เสร็จสิ้น: the last card said it all (how to see it again, the form put back) — back to the top.
      // ข้าม / Esc: one short note, at the top centre: clear of the form and its save bar
      if (done)
        window.scrollTo({
          top: 0,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        });
      else
        push({
          kind: 'info',
          title: 'ดูบทสอนอีกครั้งได้ที่ปุ่ม ? ด้านบน',
          desc: restored ? 'ฟอร์มกลับเป็นเหมือนก่อนเริ่มบทสอนแล้ว' : undefined,
          position: 'top-center',
        });
      // back to where it started from
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-label="สอนการใช้งานหน้านี้"]')?.focus({ preventScroll: true }),
      );
    },
    [push],
  );

  // the first visit to a page with a tour: ask once (after the page has settled) — unless "ไม่ต้องถามอีก"
  React.useEffect(() => {
    if (!tour || off || seen.has(path)) return;
    const t = setTimeout(() => setOfferPath(path), 800);
    return () => clearTimeout(t);
  }, [tour, off, seen, path]);

  const dismiss = (change: { seen?: string; off?: boolean }) => {
    remember(change);
    setOfferPath(null);
  };
  return (
    <TourCtx.Provider value={{ has: !!tour, start }}>
      {children}
      {run && <Runner steps={run.steps} title={tour?.title ?? ''} ctx={ctx} onEnd={end} />}
      {offer && tour && !run && (
        <div
          role="dialog"
          aria-labelledby="tour-offer"
          data-tour-offer
          className="pointer-events-auto fixed inset-x-4 z-60 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-pop no-print sm:left-auto sm:w-[340px]"
        >
          <button
            type="button"
            aria-label="ปิด"
            onClick={() => dismiss({ seen: path })}
            className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
          <p id="tour-offer" className="flex items-center gap-2 pr-6 text-sm font-semibold">
            <GraduationCap className="h-4 w-4 text-primary" />
            ดูวิธีใช้หน้านี้ไหม?
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            พาดูทีละขั้นว่าต้องกดตรงไหน กรอกอะไร ใช้เวลาประมาณ 1 นาที · ไม่บันทึกข้อมูลจริง
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => dismiss({ seen: path, off: true })}
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              ไม่ต้องถามอีก (ทุกหน้า)
            </button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => dismiss({ seen: path })}>
                ไม่ใช่ตอนนี้
              </Button>
              <Button size="sm" onClick={start}>
                เริ่มบทสอน
              </Button>
            </div>
          </div>
        </div>
      )}
    </TourCtx.Provider>
  );
}
