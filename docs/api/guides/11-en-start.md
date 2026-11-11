# 🇬🇧 Getting started

This is the API every OneService page calls (for the internal team). Every path is under `/api`. There are no API keys — you call it as the signed-in person, with that role's permissions.

## Session

- Sign in through the central SSO (`/api/sso/login` → `/api/sso/callback`) to get the `os_session` cookie (httpOnly — the browser sends it).
- 30 minutes idle and it expires (renewed by `GET /api/sso/refresh`); 12 hours at most from sign-in.
- Signing out signs that person out on every device (session_version).
- Permissions come from the role (app_config): view / add / edit / delete per module, plus special rights (SO Approve, Export, Product Cost, …). Not approved or not allowed = `403`.
- No session needed: `/api/health`, `/api/sso/*`, `/api/track/*` (the customer tracking page) and the logos of `/api/files`.

## Try it on this page

Calls the site serving this page, with your own session. Endpoints with a body start with an example; edit it, then **Send**.

⚠️ On production this is **real data** — creating, editing and deleting all happen.

## Writes: JSON only (CSRF)

- A body is JSON sent with `Content-Type: application/json`; anything else is `415`, over 1 MB `413`.
- A cookie-carrying write from another site is refused by the proxy (`403`).
- Uploads (`/api/upload`, `/api/attachments`) are `multipart/form-data`, up to 10 MB.

## Errors

```json
{ "error": "กรอกข้อมูลไม่ครบ 2 ช่อง", "details": { "fields": { "phone": "ต้องระบุเบอร์โทรศัพท์" } } }
```

- `error` is Thai, for the user — its wording is not a contract; do not parse it.
- `400` a form rule failed: `details.fields` = { field: message } — the same rules the page runs (`src/lib/validation`).
- `401` no / expired session · `403` not allowed · `404` not found.
- `409` conflict: `details.stale` (see row_version), a duplicate, or a state that no longer allows it.
- `429` too many calls: `details.retryAfter` seconds.
- `500` unexpected: quote its `ref` (the details are in the server log) · `503` the database did not answer / the query ran too long.
- `/api/track/*` answers differently: `{ "ok": false, "error": "…", "reason": "link" | "session" | "captcha" }`.

## Idempotency-Key (double submits)

The create POSTs (jobs, customers, quotations, sale orders, stock in / out) take an `Idempotency-Key` header:

- One key per press of Save (`src/lib/api.ts` postJson sends one).
- The same key again gets the same answer (`Idempotent-Replayed: true`), never a second document.
- A repeat while the first still runs = `409`; the key on another route = `422`; a failed first try frees the key.

## row_version (concurrent edits → 409)

- Document details (job, customer, quotation, sale order, part) carry a `version`.
- Send back the `version` you loaded when you save. If someone saved in between: `409` with `details.stale: true` — reload, then edit again.
- No `version` = the old last-write-wins.

## Lists and paging

- `GET /api/data/{resource}` is the read side of every page; it answers an array.
- `paged=1` answers one page `{ rows, total, page, pageSize }` — `page` from 1, `pageSize` 1–500 (default 25), `sort` + `dir` (`asc` / `desc`), `q` to search.
- `deleted`: `exclude` (default: all but deleted) / `active` / `only` / `all` — deletion is soft (`record_status`).
- Dates are `YYYY-MM-DD`, Thai time. `GET /api/export/{resource}` takes the same filters and answers an Excel file.
