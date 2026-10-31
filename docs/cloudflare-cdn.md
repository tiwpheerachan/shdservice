# Cloudflare CDN — คู่มือตั้งค่าสำหรับเจ้าของระบบ (แพ็กเกจ Free)

ทุกขั้นในคู่มือนี้ใช้ได้กับแพ็กเกจ **Free** ทำตามลำดับ แต่ละขั้นมีวิธีตรวจด้วย `curl` และวิธีย้อนกลับ
โดเมนในตัวอย่าง: แอป `oneservice.shd-technology.co.th`, วิดีโอ `media-oneservice.shd-technology.co.th`
ข้อมูลอ้างอิงจากเอกสาร Cloudflare ฉบับปัจจุบัน (ตรวจเมื่อ 2026-10-31) — ลิงก์อยู่ท้ายแต่ละหัวข้อ

## 0. อะไรแคชได้ อะไรห้ามแคช

| เส้นทาง | ส่งจาก origin (Render) | ที่ขอบ Cloudflare |
|---|---|---|
| หน้า HTML, RSC (`?_rsc=`), `/api/*` | `private, no-store` — ข้อมูลของผู้ใช้แต่ละคน | **ห้ามแคชเด็ดขาด** (Cache Rule ข้อ 3 กันซ้ำ) |
| `/_next/static/*` (JS/CSS/ฟอนต์ ชื่อไฟล์มี hash) | `public, max-age=31536000, immutable` | แคช 1 ปี |
| รูปใน `public/` (`/logo.png` ฯลฯ) | `public, max-age=86400, stale-while-revalidate=604800` | แคชตามนามสกุล (ค่าเริ่มต้น) |
| `/manifest.webmanifest` | `public, max-age=86400, …` (ไม่ต้องล็อกอิน) | แคช (Cache Rule ข้อ 2 — `.webmanifest` ไม่อยู่ในรายการนามสกุลที่แคชเอง) |
| รูปถ่าย / สลิป / PDF | redirect ไป signed URL ของ Supabase Storage | ไม่ผ่าน Cloudflare (Supabase มี CDN ของตัวเอง) |
| วิดีโอ + ภาพตัวอย่าง (R2) | redirect ไป `media-oneservice.…` (หลังทำข้อ 5–6) | Worker ตรวจลายเซ็น แล้วส่งจากแคชของ Cloudflare |

ข้อเท็จจริงจากเอกสาร: Cloudflare แคชตาม **นามสกุลไฟล์** ไม่ใช่ตามชนิดเนื้อหา — HTML และ JSON ไม่ถูกแคชเองอยู่แล้ว,
ขนาดไฟล์สูงสุดที่แคชได้บน Free = 512 MB (วิดีโอเรา ≤ 200 MB)
https://developers.cloudflare.com/cache/concepts/default-cache-behavior/

## 1. Smart Tiered Cache (ลด MISS ที่สลับกันระหว่างศูนย์ข้อมูลในไทย)

ตอนนี้ไฟล์ `/_next/static` เป็น HIT ที่ศูนย์หนึ่ง แต่ MISS อีกศูนย์ เพราะแต่ละศูนย์ไปขอ Render เอง
Smart Tiered Cache ให้ทุกศูนย์ไปถาม "ศูนย์ชั้นบน" ศูนย์เดียวก่อน (ใกล้ Render สิงคโปร์) — ใช้ได้บน Free

1. Dashboard → เลือกโซน `shd-technology.co.th` → **Caching → Tiered Cache**
2. เปิด **Tiered Cache** → Tiered Cache Topology → **Smart Tiered Caching** → Save

ข้อควรรู้: ถ้าเปลี่ยน IP/DNS ของ origin ศูนย์ชั้นบนอาจย้าย MISS จะสูงขึ้นชั่วครู่ (เอกสารบางหน้าเรียกส่วนนี้ว่า "Smart Shield")
https://developers.cloudflare.com/cache/how-to/tiered-cache/ · https://developers.cloudflare.com/smart-shield/get-started/

## 2. Speed: บีบอัด, Early Hints, HTTP/3

**บีบอัด (Zstandard / Brotli)** — แอปเวอร์ชันนี้ **ไม่ gzip เองแล้ว** (`next.config.mjs` `compress: false`) เพราะถ้า origin ส่ง gzip
Cloudflare จะส่ง gzip ต่อตามเดิม; ส่งแบบไม่บีบอัด Cloudflare จะบีบให้เองเป็น zstd / br / gzip ตามที่เบราว์เซอร์รับได้
เอกสารบอกว่าแพ็กเกจ Free บีบอัดด้วย Zstandard เป็นค่าเริ่มต้น (`text/html`, JS, CSS, JSON, `text/x-component` = RSC อยู่ในรายการ)
— ปกติไม่ต้องกดอะไร ถ้าตรวจ (ข้อ 4) แล้ว `content-encoding` ไม่ใช่ `zstd`/`br`:

1. **Rules → Compression Rules → Create rule** (Free ได้ 10 ข้อ) ชื่อ `zstd-br`
2. If: **All incoming requests** → Then: **Custom** → เรียง `Zstandard`, `Brotli`, `Gzip` → Deploy

ห้ามเปิด Rocket Loader / Automatic HTTPS Rewrites เพื่อการบีบอัด (มันแก้เนื้อหา และ CSP ของแอปไม่ยอมสคริปต์แปลกปลอม)
https://developers.cloudflare.com/speed/optimization/content/compression/ · https://developers.cloudflare.com/rules/compression-rules/

**Early Hints** (ส่ง 103 ให้เบราว์เซอร์โหลด CSS/JS ก่อนหน้าเสร็จ — ใช้ได้ทุกแพ็กเกจ): **Speed → Settings → Content Optimization → Early Hints → On**
ได้ผลเฉพาะเมื่อ origin ส่ง header `Link: …; rel=preload` — ไม่มีผลเสียถ้าไม่มี
https://developers.cloudflare.com/cache/advanced-configuration/early-hints/

**HTTP/3 (QUIC)**: **Speed → Settings → Protocol Optimization → HTTP/3 → On** (ทุกแพ็กเกจ; มือถือในพื้นที่ซ่อมเน็ตไม่นิ่งได้ประโยชน์)
**0-RTT: ปล่อยปิดไว้** — คำขอถูกเล่นซ้ำได้ (replay) และระบบเรามีการเขียนข้อมูล
https://developers.cloudflare.com/speed/optimization/protocol/http3/ · https://developers.cloudflare.com/speed/optimization/protocol/0-rtt-connection-resumption/

## 3. Cache Rules (Free ได้ 10 ข้อ — ใช้ 3)

**Caching → Cache Rules → Create rule** สร้างตามลำดับนี้ (กฎทำงานบนลงล่าง ข้อหลังที่ตรงเงื่อนไขเขียนทับข้อก่อน —
จึงวาง "ห้ามแคช" ไว้ **ล่างสุด** ให้ชนะเสมอถ้าวันหน้ามีใครเพิ่มกฎที่ทับกัน) ทุกข้อกด **Edit expression** แล้ววางนิพจน์ตามนี้ตรงตัว

**ข้อ 1 — `next-static-1y`**
```
(http.host eq "oneservice.shd-technology.co.th" and starts_with(http.request.uri.path, "/_next/static/"))
```
- Cache eligibility: **Eligible for cache**
- Edge TTL: **Use cache-control header if present, use default Cache TTL if not** → default **1 year**
- Browser TTL: **Respect origin TTL**
- อย่างอื่นปล่อยค่าเดิม (cache key ปรับได้เฉพาะ Enterprise อยู่แล้ว)

**ข้อ 2 — `manifest`**
```
(http.host eq "oneservice.shd-technology.co.th" and http.request.uri.path eq "/manifest.webmanifest")
```
- **Eligible for cache** · Edge TTL: **Use cache-control header if present, bypass cache if not** · Browser TTL: **Respect origin TTL**

**ข้อ 3 — `no-cache-html-api`** (กันซ้ำ: origin ส่ง `no-store` อยู่แล้ว)
```
(http.host eq "oneservice.shd-technology.co.th" and (starts_with(http.request.uri.path, "/api/") or starts_with(http.request.uri.path, "/print/") or starts_with(http.request.uri.path, "/track/") or http.request.uri.path.extension eq ""))
```
- Cache eligibility: **Bypass cache**
- `extension eq ""` = ทุกหน้า (`/`, `/jobs/list`, `/login` และคำขอ RSC ที่ path เดียวกัน) — ไฟล์ที่มีนามสกุลไม่โดน
- `/print/` และ `/track/` ระบุแยก เพราะ id/ลิงก์ในนั้นอาจมีจุด (เช่น `…/QT2026.001`) ซึ่ง Cloudflare จะมองเป็น "นามสกุล"
- **ต้องอยู่ล่างสุดเสมอ** — ถ้าเพิ่มกฎใหม่ ให้ลากกฎนี้กลับไปไว้ท้าย

ที่เหลือ (รูปใน `public/`, `robots.txt`) ไม่ต้องมีกฎ — แคชตามนามสกุลและ `Cache-Control` ของ origin
ข้อจำกัด Free: Edge TTL ต่ำสุด 2 ชม. (ไม่กระทบ — เราตั้ง 1 ปีหรือเคารพ origin), cache key ตาม header/cookie = Enterprise เท่านั้น
https://developers.cloudflare.com/cache/how-to/cache-rules/ · https://developers.cloudflare.com/cache/how-to/cache-rules/settings/ · https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/

## 4. ตรวจข้อ 1–3 ด้วย curl

```sh
APP=https://oneservice.shd-technology.co.th
JS=$(curl -s $APP/login | grep -o '/_next/static/[^"]*\.js' | head -1); echo $JS
# ยิง 2–3 ครั้ง: ครั้งแรกอาจ MISS, ต่อไปต้อง HIT และ age เพิ่มขึ้น; content-encoding = zstd หรือ br
curl -s -o /dev/null -D - -H 'Accept-Encoding: zstd, br, gzip' "$APP$JS" | grep -iE '^(cf-cache-status|age|content-encoding|cache-control):'
# หน้า HTML: cf-cache-status = BYPASS (หรือ DYNAMIC), cache-control = private, no-store; content-encoding = zstd/br
curl -s -o /dev/null -D - -H 'Accept-Encoding: zstd, br, gzip' $APP/login | grep -iE '^(cf-cache-status|cache-control|content-encoding):'
# API: BYPASS + no-store
curl -s -o /dev/null -D - $APP/api/me | grep -iE '^(cf-cache-status|cache-control):'
# manifest: 200 (ไม่ใช่ 307 ไป /login), public, max-age=86400; ครั้งที่สอง HIT
curl -s -o /dev/null -D - $APP/manifest.webmanifest | grep -iE '^(HTTP|cf-cache-status|cache-control|content-type)'
```
Tiered Cache: ดูผลที่ **Analytics → Caching** (สัดส่วน served by Cloudflare ควรสูงขึ้น และ HIT/MISS ไม่สลับไปมาระหว่างศูนย์)

## 5. วิดีโอผ่าน CDN: Worker `media-oneservice.shd-technology.co.th`

ทำไมต้องเป็น Worker: เปิด R2 custom domain แบบตรง ๆ = bucket เป็น **สาธารณะ** ใครมีลิงก์ก็ดูได้ตลอดไป
การตรวจลิงก์ที่มีลายเซ็นด้วย WAF (`is_timed_hmac_valid_v0`) ต้อง Pro ขึ้นไป — บน Free จึงใช้ Worker ที่ผูก bucket (R2 binding)
ตรวจลายเซ็น HMAC-SHA256 เอง แล้วเก็บไฟล์ใน cache ของ Cloudflare (Cache API) ให้ทุกคนที่ดูวิดีโอเดียวกันใช้ชุดเดียวกัน
https://developers.cloudflare.com/r2/buckets/public-buckets/ · https://developers.cloudflare.com/waf/custom-rules/use-cases/configure-token-authentication/ · https://developers.cloudflare.com/workers/examples/signing-requests/

การทำงาน (`workers/media/src/index.ts`, รูปแบบลิงก์ `workers/media/src/media.ts` ใช้ร่วมกับแอป):
แอปตรวจสิทธิ์ → redirect ไป `https://media…/jobs/{เลขงาน}/attachments/v….mp4?exp=…&sig=…` (อายุ 15 นาทีเท่าเดิม; ภาพตัวอย่าง 1 วัน)
→ Worker: ลายเซ็นผิด/หมดอายุ = 403 · มีใน cache = ส่งเลย (รองรับ Range → 206) · ไม่มี = อ่านช่วงที่ขอจาก R2 ส่งให้ผู้ชม
และเก็บไฟล์ทั้งไฟล์ลง cache 30 วัน (ไฟล์ใน R2 ไม่เคยถูกเขียนทับ — อัปโหลดใหม่ได้ชื่อใหม่เสมอ)
เบราว์เซอร์ได้ `Cache-Control: private, max-age=<วินาทีจนลิงก์หมดอายุ>` (Worker ไม่รับลิงก์ที่อายุเกิน 2 วัน) · การ "ดาวน์โหลด" ยังใช้ลิงก์ R2 ตรงเหมือนเดิม (ตั้งชื่อไฟล์ให้)
Worker ส่งเฉพาะ `Content-Type` ที่เป็นวิดีโอ/JPEG (อย่างอื่นเป็น `application/octet-stream`), ขนาด/ช่วง, ETag พร้อม
`Content-Security-Policy: sandbox; default-src 'none'` และ `nosniff` — ไม่คัด metadata อื่นของไฟล์ใน R2 ออกไป

**ลบไฟล์แนบวิดีโอแล้ว**: แอปเลิกออกลิงก์ใหม่ให้ไฟล์นั้นทันที แต่คนที่ได้ลิงก์ไปก่อนลบยังเปิดได้จนลิงก์หมดอายุ
(วิดีโอ ≤ 15 นาที, ภาพตัวอย่าง ≤ 24 ชม. — เท่ากับลิงก์ R2 ตรงเดิม) เพราะสำเนาใน cache ไม่ถาม R2 อีก
สำเนาที่ค้างใน cache (≤ 30 วัน) เข้าถึงไม่ได้ถ้าไม่มีลายเซ็นที่ยังไม่หมดอายุ — จึงไม่ต้องมีระบบล้าง cache

ต้องมี: Node 20+ บนเครื่อง, บัญชี Cloudflare ที่ดูแลโซน `shd-technology.co.th` และ bucket R2 เดียวกับ `R2_BUCKET` บน Render
และ **ต้องไม่มี DNS record ชื่อ `media-oneservice` อยู่ก่อน** (Custom Domain จะสร้าง record + ใบรับรองให้เอง)

```sh
cd workers/media
# 0) ชื่อ bucket ใน wrangler.toml (bucket_name) ต้องตรงกับ R2_BUCKET บน Render — บน prod คือ oneservicevideos
npx wrangler@4 login                 # เปิดเบราว์เซอร์ให้ยืนยันบัญชี
npx wrangler@4 whoami                # ตรวจว่าเป็นบัญชีที่ถูก
npx wrangler@4 r2 bucket list        # ต้องเห็น oneservicevideos
npx wrangler@4 deploy                # สร้าง Worker oneservice-media + Custom Domain media-oneservice.shd-technology.co.th
openssl rand -hex 32                 # สร้างกุญแจ — คัดลอกเก็บไว้ (ใช้ซ้ำในข้อ 6) อย่าใส่ในไฟล์ใด ๆ
npx wrangler@4 secret put MEDIA_SIGNING_KEY   # วางกุญแจเมื่อถูกถาม (deploy เวอร์ชันใหม่ให้ทันที)
```
ระหว่างที่ยังไม่มี secret Worker ตอบ 403 ทุกคำขอ (ปลอดภัย) · ตรวจใน Dashboard: **Workers & Pages → oneservice-media → Settings → Domains & Routes** ต้องเห็น `media-oneservice.shd-technology.co.th`
(`workers_dev = false` — ไม่มีชื่อ `*.workers.dev` ให้เข้าอ้อม; Cache API ทำงานบน custom domain)
https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ · https://developers.cloudflare.com/workers/wrangler/commands/workers/ · https://developers.cloudflare.com/workers/runtime-apis/cache/

ตรวจ Worker ก่อนเปิดใช้ในแอป (ใช้ไฟล์วิดีโอจริงหนึ่งไฟล์ — ดู path จากช่อง Network ของเบราว์เซอร์ตอนเปิดวิดีโอ: ส่วน `jobs/…/attachments/v….mp4` ในลิงก์ r2.cloudflarestorage.com):
```sh
cd ../..   # กลับมาที่ราก repo
read -s MEDIA_SIGNING_KEY; export MEDIA_SIGNING_KEY   # วางกุญแจ (ไม่ขึ้นจอ ไม่ลง history)
URL=$(npx tsx -e "import('./workers/media/src/media.ts').then(async (m) => console.log(await m.mediaUrl('https://media-oneservice.shd-technology.co.th', process.env.MEDIA_SIGNING_KEY, 'jobs/<เลขงาน>/attachments/<ไฟล์>.mp4', 900)))")
curl -s -o /dev/null -D - -H 'Range: bytes=0-1023' "$URL" | grep -iE '^(HTTP|content-range|accept-ranges|content-type|cache-control|x-media-cache)'
#   ครั้งแรก: HTTP 206, content-range: bytes 0-1023/<ขนาด>, x-media-cache: MISS, cache-control: private, max-age=~900
curl -s -o /dev/null -D - -H 'Range: bytes=0-1023' "$URL" | grep -iE '^(HTTP|x-media-cache)'
#   ครั้งที่สอง (ไม่กี่วินาทีต่อมา, ศูนย์ข้อมูลเดียวกัน): 206 + x-media-cache: HIT
curl -s -o /dev/null -w '%{http_code}\n' "${URL%%\?*}"                        # ไม่มีลายเซ็น → 403
curl -s -o /dev/null -w '%{http_code}\n' "${URL/sig=/sig=x}"                  # ลายเซ็นผิด → 403
```
หมายเหตุ: คำตอบจาก Worker ไม่มี `cf-cache-status` ให้ดู `x-media-cache` แทน · cache ของ Worker แยกต่อศูนย์ข้อมูล
(Cache API ไม่ใช้ Tiered Cache) — ศูนย์ใหม่จะ MISS ครั้งแรกหนึ่งครั้งต่อไฟล์ แล้ว HIT
https://developers.cloudflare.com/workers/reference/how-the-cache-works/
ถ้าเปิด Bot Fight Mode / Under Attack ไว้ อาจโดน challenge กับคำขอวิดีโอ — ตรวจด้วย curl ข้างบน (ต้องได้ 206 ไม่ใช่ 403 แบบหน้า HTML)

## 6. เปิดใช้ในแอป (Render)

Render → service OneService → **Environment** → เพิ่ม 2 ตัว แล้ว **Save, rebuild and deploy**:
- `MEDIA_BASE_URL` = `https://media-oneservice.shd-technology.co.th` (https เท่านั้น ไม่มี path)
- `MEDIA_SIGNING_KEY` = กุญแจเดียวกับ `wrangler secret put` ในข้อ 5

ตรวจหลัง deploy: log ตอนเริ่มต้องไม่มี `MEDIA_…` ใน "env check: optional configuration missing" · เปิดงานที่มีวิดีโอ →
Network: `/api/files?path=…mp4` ตอบ 307 ไป `https://media-oneservice.shd-technology.co.th/…?exp=…&sig=…`, วิดีโอเล่นและเลื่อนได้ (206),
เปิดซ้ำ/อีกเครื่อง → `x-media-cache: HIT` · ภาพตัวอย่างวิดีโอก็มาจาก `media-oneservice.` (CSP ของแอปอนุญาตโดเมนนี้ให้อัตโนมัติ)

## 7. ย้อนกลับ / เมื่อวิดีโอเปิดไม่ได้

อาการจาก `media-oneservice.` (ดูใน Network หรือ `npx wrangler@4 tail` ในโฟลเดอร์ `workers/media`):
- **403** = ลิงก์หมดอายุ / ลายเซ็นไม่ตรง — ปกติแก้ด้วยการกดเปิดวิดีโอใหม่; ถ้าเป็นทุกไฟล์ = กุญแจบน Render กับ Worker ไม่ตรงกัน
- **503** (ว่างเปล่า) = Worker อ่าน R2 / cache ไม่ได้ — รายละเอียดอยู่ใน log (`media failed …`) ไม่ส่งให้ผู้ใช้
- **Error 1101** = Worker พังเอง (exception ที่หลุดออกมา) · **Error 1027** = เกินโควตา 100,000 คำขอ/วันของ Free (กลับมาเอง 07:00 น.)
- ทุกกรณีที่ไม่หายเอง: ทำข้อแรกด้านล่าง (ถอดตัวแปรบน Render) — วิดีโอกลับไปใช้ลิงก์ R2 ตรงทันทีหลัง deploy

- วิดีโอมีปัญหา: ลบ `MEDIA_BASE_URL` และ `MEDIA_SIGNING_KEY` บน Render → deploy → วิดีโอกลับไปใช้ลิงก์ R2 ตรงทันที (Worker ทิ้งไว้ได้ ไม่มีใครถูกส่งไป)
- เปลี่ยนกุญแจ (หลุด): `wrangler secret put` ค่าใหม่ + แก้บน Render ให้ตรงกัน — ลิงก์เก่าใช้ไม่ได้ทันที (ผู้ใช้กดเปิดวิดีโอใหม่)
- Cache Rule: ปิดสวิตช์ของกฎนั้นในหน้า Cache Rules · Tiered Cache: ปิดในหน้าเดิม · ล้าง cache: **Caching → Configuration → Purge Cache**
  (cache ของ Worker ไม่ถูกล้างด้วยปุ่มนี้ทั้งหมด — แต่ไม่จำเป็น: ไฟล์ไม่เคยเปลี่ยน และเข้าถึงได้เฉพาะด้วยลิงก์ที่แอปลงนาม)

## 8. ค่าใช้จ่ายบน Free และเมื่อไรควรจ่าย

| รายการ | ขีดจำกัด Free | การใช้ที่คาด |
|---|---|---|
| Workers requests | **100,000 / วัน** (รีเซ็ต 07:00 น. เวลาไทย) | การดู 1 ครั้ง ≈ 3–10 คำขอ (Range ตอนเล่น/เลื่อน) + ภาพตัวอย่าง (เบราว์เซอร์เก็บ 1 วัน) → พนักงาน 50 คน × ดู 40 คลิป/วัน × 10 ≈ 20,000 |
| Workers CPU | 10 ms / คำขอ | ตรวจ HMAC + ส่งต่อ stream ≈ 1–2 ms (การส่งข้อมูลไม่นับ CPU) |
| Cache API | ไฟล์ละ ≤ 512 MB | วิดีโอ ≤ 200 MB |
| R2 | เก็บฟรี 10 GB-เดือน, อ่าน (Class B) ฟรี 10 ล้าน/เดือน, **egress ฟรี** | MISS = อ่าน R2 3 ครั้ง (head + ช่วงที่ขอ + ทั้งไฟล์ลง cache); HIT = 0 |
| Cache Rules / Compression Rules | 10 / 10 | ใช้ 3 / 0–1 |

เกิน 100,000 คำขอ/วัน: Worker ตอบ **Error 1027** จนถึง 07:00 น. — วิดีโอเปิดไม่ได้ (หน้าอื่นไม่กระทบ) แก้ด่วนด้วยข้อ 7
https://developers.cloudflare.com/workers/platform/limits/ · https://developers.cloudflare.com/r2/pricing/

ควรจ่ายเมื่อ:
- **Workers Paid ($5/เดือน)** — อย่างแรกที่ควรซื้อถ้า Workers analytics แตะ ~50,000/วัน: 10 ล้านคำขอ/เดือน, CPU สูงขึ้น, ไม่มีเพดานรายวัน
- **Pro ($20/เดือนรายปี, $25 รายเดือน)** — ได้ WAF token authentication (ตรวจลิงก์ลงนามได้โดยไม่ต้องใช้ Worker), Edge TTL ต่ำสุด 1 ชม., Polish รูปภาพ;
  ระบบเราไม่จำเป็นตอนนี้ (HTML/API ไม่แคชอยู่แล้ว รูปอยู่ที่ Supabase) https://www.cloudflare.com/plans/
- **Cache Reserve** — แคชถาวรบน R2 สำหรับไฟล์ที่นาน ๆ ถูกขอที (ไฟล์ TTL ≥ 10 ชม.) คิดตามการใช้;
  ไม่คุ้มสำหรับเรา: ต้นทางวิดีโอคือ R2 อยู่แล้ว (egress ฟรี) และเอกสาร Smart Shield ระบุว่าแพ็กเกจที่รวม Cache Reserve ไม่เปิดให้ Free/Pro/Business
  https://developers.cloudflare.com/cache/advanced-configuration/cache-reserve/
- **Argo Smart Routing** (เริ่ม $5/เดือน + ตามปริมาณ) — เร่งเส้นทาง Cloudflare → origin สำหรับหน้า/API ที่แคชไม่ได้;
  Render อยู่สิงคโปร์ ใกล้ไทยอยู่แล้ว ผลน้อย — พิจารณาเมื่อวัด TTFB จากต่างจังหวัดแล้วช้าจริง https://developers.cloudflare.com/argo-smart-routing/

## 9. สิ่งที่ Free ทำไม่ได้ (และเราเลี่ยงอย่างไร)

- ตรวจลิงก์ลงนามที่ขอบด้วย WAF (Pro+) → ใช้ Worker ตรวจเอง
- Tiered Cache ให้ cache ของ Worker (Cache API แยกต่อศูนย์ข้อมูลทุกแพ็กเกจ) → แต่ละศูนย์ MISS ครั้งแรกครั้งเดียวต่อไฟล์ อ่านจาก R2 (ฟรี egress)
- Cache key ตาม header/cookie, Regional Tiered Cache (Enterprise) — ไม่จำเป็น
- Edge TTL ต่ำกว่า 2 ชม. — ไม่จำเป็น
