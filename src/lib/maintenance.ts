/**
 * Maintenance mode (cutover day, planned work) — applied by src/proxy.ts to every request it sees.
 *   MAINTENANCE_MODE=1          every page answers 503 + the page below, every /api/* 503 JSON.
 *                               /api/health is outside the proxy matcher: it keeps answering (+ maintenance: true).
 *   MAINTENANCE_UNTIL           optional free text shown on the page ("21 ต.ค. 18:00").
 *   MAINTENANCE_BYPASS_SECRET   optional, ≥ 16 chars (openssl rand -hex 16): opening any page with ?maintenance_bypass=<secret> sets an
 *                               HttpOnly cookie that lets that browser see the real app (the team checks
 *                               the system before opening). Unset = nobody gets through.
 * Read per request, but Render hands a changed env var only to a new deploy / restart.
 * No node: imports — the proxy uses this.
 */
import { COMPANY } from './company';
import { hostCookie } from './session';
import { sameString } from './origin-auth';
import { THEME_SCRIPT } from './theme-script-source';

export const BYPASS_PARAM = 'maintenance_bypass';
export const BYPASS_COOKIE = hostCookie('os_maint');
export const RETRY_AFTER_S = 600;
export const MAINTENANCE_ERROR = 'ระบบปิดปรับปรุง กรุณากลับมาใหม่ภายหลัง';

export const maintenanceOn = () => (process.env.MAINTENANCE_MODE ?? '').trim() === '1';

/** the value matches MAINTENANCE_BYPASS_SECRET (constant time); never true while it is unset or under 16 chars */
export function bypassOk(value: string | null | undefined): boolean {
  const secret = (process.env.MAINTENANCE_BYPASS_SECRET ?? '').trim();
  return secret.length >= 16 && !!value && sameString(value, secret);
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The whole page, self-contained: no app code runs, so nothing touches the database. The only script is
 * THEME_SCRIPT byte for byte (the proxy allows it by its sha256), which sets the `dark` class like every page.
 */
export function maintenanceHtml(): string {
  const until = (process.env.MAINTENANCE_UNTIL ?? '').trim();
  const tel = COMPANY.phone.replace(/[^0-9+]/g, '');
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>ระบบปิดปรับปรุง · OneService</title>
<script>${THEME_SCRIPT}</script>
<style>
:root{--bg:hsl(210 25% 97%);--card:#fff;--fg:hsl(222 47% 12%);--muted:hsl(215 16% 42%);--border:hsl(214 22% 89%);--accent:hsl(215 70% 40%);color-scheme:light}
.dark{--bg:hsl(222 40% 8%);--card:hsl(222 34% 11%);--fg:hsl(210 25% 94%);--muted:hsl(215 18% 62%);--border:hsl(222 25% 20%);--accent:hsl(210 90% 70%);color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--fg);
font-family:"Noto Sans Thai","Sukhumvit Set","Leelawadee UI",Tahoma,system-ui,sans-serif;line-height:1.6}
main{width:100%;max-width:440px;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:32px 24px;text-align:center}
.logo{height:32px;width:auto}.logo-dark,.dark .logo-light{display:none}.dark .logo-dark{display:inline}
h1{font-size:1.5rem;margin:24px 0 8px}p{margin:4px 0;color:var(--muted)}
.until{color:var(--fg);font-weight:600}
footer{margin-top:24px;padding-top:16px;border-top:1px solid var(--border);font-size:.85rem;color:var(--muted)}
a{color:var(--accent)}
</style>
</head>
<body>
<main>
<img class="logo logo-light" src="/logo.png" alt="OneService">
<img class="logo logo-dark" src="/logo-dark.png" alt="OneService">
<h1>ระบบปิดปรับปรุง</h1>
${until ? `<p class="until">คาดว่าจะเปิดให้ใช้งานได้ ${esc(until)}</p>\n` : ''}<p>กรุณากลับมาใหม่ภายหลัง</p>
<footer>${esc(COMPANY.nameTh)}<br>โทร <a href="tel:${tel}">${esc(COMPANY.phone)}</a></footer>
</main>
</body>
</html>`;
}
