import { MODULE_LABELS, type Module } from '@/lib/modules';
import { MAX_EXPORT_ROWS } from '@/lib/export-limit';
import type { Step, StepCtx, Tour } from '../tours';

/** บทสอน — see tours.ts for the target syntax and the rules every tour follows */

/** the 7 reports share one layout (src/components/shared/report-view.tsx): header buttons · เงื่อนไขการออกรายงาน ·
 *  ตัวเลขสรุป · ตาราง. These find its parts. */
const ACTIONS = 'main div:has(> h1) + div'; // พิมพ์รายงาน · Excel · PDF
const FOLDED = 'main div.surface.no-print > button[aria-expanded="false"]'; // the filter bar's own toggle
const SEARCH = 'main div.surface.no-print div.border-t'; // ค้นหา · ล้างค่า
const KPIS = 'main div.grid:has(> div.surface > p.num)';
const HEAD = 'main table thead';
/* A folded filter bar (phones start folded) is `inert`: find() skips its fields and ค้นหา, so their steps drop out
 * by themselves and FOLDED says to open it first. */

const JOB_SCREENS: Module[] = ['Job Management', 'Job Assign', 'Job Repair', 'Job Closing'];
const menus = (ms: Module[]) => ms.map((m) => MODULE_LABELS[m as keyof typeof MODULE_LABELS] ?? m).join(' / ');
const JOB_FILE = 'ไฟล์มีคอลัมน์เพิ่ม เช่น IMEI, Serial, อาการเสีย, ค่าอะไหล่, ยอดชำระ';

type Filter = { target: string; title: string; body: string; example?: string };
type Report = {
  path: string;
  /** = the page's h1 */
  title: string;
  /** what the report answers (the welcome card) */
  answers: string;
  /** the date pair (labels) and which date it filters on — none: a balance as of now */
  dates?: { from: string; to: string; body: string };
  filters: Filter[];
  /** what each tile counts, in their order */
  kpis: string;
  /** the table's columns: always shown · จอกว้างมี (lg / md) · จอกว้างมากมี (xl) */
  table: string;
  /** headers that do not sort (the server has no order for them) — none: every header sorts */
  noSort?: string;
  /** what the Excel holds beyond the table */
  file: string;
  /** the menus whose view shows the table (report-access.ts `read`) — null: the right Report alone */
  read: Module[] | null;
  /** the export's module: its view + the special right ส่งออก Excel show the button ('Report': the right alone) */
  exportModule: Module;
};

/** one tour for every report page: a fix here lands on all 7 */
function reportTour(r: Report): Tour {
  const canTable = ({ can }: StepCtx) => !r.read || r.read.some((m) => can(m, 'view'));
  const exportNeeds =
    'สิทธิ์พิเศษ "ส่งออก Excel"' + (r.exportModule === 'Report' ? '' : ` และสิทธิ์ดู ${menus([r.exportModule])}`);
  // look: Enter in a filter field runs ค้นหา (FilterBar), and putting the draft back would not undo that search
  const filterStep = (f: Filter): Step => ({ ...f, look: true });
  const steps: Step[] = [
    {
      title: 'ดูอะไรได้จากรายงานนี้',
      body: `${r.answers} · บทสอนพาดูจากบนลงล่าง ดูอย่างเดียว ไม่มีอะไรถูกบันทึกหรือส่งออก`,
    },
    {
      target: ACTIONS,
      title: 'พิมพ์ และส่งออก Excel',
      body: ({ has }) =>
        'พิมพ์รายงาน / PDF: เปิดหน้าต่างพิมพ์ ได้ตัวเลขสรุปกับแถวในหน้านี้ · ' +
        (has('button:Excel')
          ? `Excel: ทุกแถวตามการค้นหาล่าสุด (สูงสุด ${MAX_EXPORT_ROWS.toLocaleString('en-US')} แถว) · ${r.file} · บันทึกในประวัติการใช้งาน`
          : `ปุ่ม Excel แสดงเมื่อบทบาทมี${exportNeeds}`),
      look: true,
    },
    {
      target: FOLDED,
      title: 'เปิดตัวกรองก่อน',
      body: 'เงื่อนไขการออกรายงานพับอยู่ (บนมือถือพับไว้ตั้งแต่เปิดหน้า) — จบบทสอนแล้วแตะ "แสดงตัวกรอง" ที่แถบนี้ แล้วกด ? อีกครั้ง เพื่อดูทีละช่อง',
      look: true,
    },
    ...(r.dates
      ? [
          filterStep({
            target: `field:${r.dates.from}|${r.dates.to}`,
            title: 'ช่วงวันที่',
            body: `${r.dates.body} · เริ่มต้นย้อนหลัง 30 วันถึงวันนี้ · วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด`,
          }),
        ]
      : []),
    ...r.filters.map(filterStep),
    {
      target: SEARCH,
      title: 'ค้นหา / ล้างค่า',
      body:
        'เปลี่ยนเงื่อนไขแล้วกด "ค้นหา" ตัวเลขสรุปและตารางจึงเปลี่ยน (หรือกด Enter ในช่องที่พิมพ์) · ' +
        (r.dates
          ? '"ล้างค่า": ทุกช่องกลับเป็นเงื่อนไขเริ่มต้นของรายงาน (รวมช่วงวันที่) แล้วค้นหาใหม่'
          : '"ล้างค่า": ทุกช่องกลับเป็นเงื่อนไขเริ่มต้นของรายงาน แล้วค้นหาใหม่'),
      look: true,
    },
    {
      target: KPIS,
      title: 'ตัวเลขสรุป',
      body: `${r.kpis} · นับทุกแถวที่ตรง ไม่ใช่แค่หน้านี้`,
      look: true,
    },
    {
      target: HEAD,
      title: 'ตาราง',
      body: (c) =>
        canTable(c)
          ? `${r.table} · กดหัวคอลัมน์เพื่อเรียง${r.noSort ? ` (ยกเว้น ${r.noSort})` : ''}`
          : `ตารางว่างเพราะบทบาทนี้ยังไม่มีสิทธิ์ดู ${menus(r.read ?? [])} (เมนูใดเมนูหนึ่ง) — ตัวเลขสรุปยังดูได้`,
      look: true,
    },
  ];
  return { title: r.title, steps };
}

const REPORTS: Report[] = [
  {
    path: '/reports/open-job',
    title: 'รายงานการเปิดงานซ่อม',
    answers:
      'งานที่เปิดในช่วงวันที่ที่เลือก: เปิดไปกี่งาน ยังไม่เริ่มกี่งาน เฉลี่ยวันละกี่งาน และมาจากช่องทางการขายไหนมากสุด',
    dates: { from: 'วันที่เปิดงาน (ตั้งแต่)', to: 'วันที่เปิดงาน (ถึง)', body: 'นับตามวันที่เปิดงาน' },
    filters: [
      {
        target: 'field:ประเภทงาน|ช่องทางการขาย',
        title: 'ประเภทงาน และช่องทางการขาย',
        body: 'ประเภทงาน: ประเภทงานหลักของงาน · ช่องทางการขาย: ช่องทางที่ลูกค้าซื้อสินค้า (ช่อง Channel ตอนเปิดงาน) · ทั้งหมด = ไม่กรอง',
      },
    ],
    kpis: 'งานที่เปิดทั้งหมด: ในช่วงนี้ · งานใหม่ (ยังไม่เริ่ม): ที่ตอนนี้ยังเป็น "งานใหม่" · เฉลี่ยต่อวัน: งานทั้งหมด ÷ จำนวนวันในช่วง (นับหัวและท้าย) · ช่องทางหลัก: ช่องทางที่มีงานมากสุด',
    table:
      'เลขที่งาน วันที่เปิดงาน ลูกค้า และสถานะงาน (สถานะตอนนี้) · จอกว้างมี เลขคำสั่งซื้อ ยี่ห้อ, รุ่น และผู้รับผิดชอบ · จอกว้างมากมี ประเภทงาน',
    file: JOB_FILE,
    read: JOB_SCREENS,
    exportModule: 'Job Management',
  },
  {
    path: '/reports/repair-job',
    title: 'รายงานการซ่อม',
    answers: 'งานที่ซ่อมในช่วงวันที่ที่เลือก: ซ่อมไปกี่งาน สำเร็จกี่งาน มูลค่ารวมเท่าไร แยกดูตามช่างหรืออาการเสียได้',
    dates: {
      from: 'วันที่ซ่อม (ตั้งแต่)',
      to: 'วันที่ซ่อม (ถึง)',
      body: 'นับตามวันที่ซ่อมของงาน งานที่ยังไม่มีวันที่ซ่อมไม่อยู่ในรายงานนี้',
    },
    filters: [
      {
        target: 'field:ประเภทงาน|ช่างผู้รับผิดชอบ',
        title: 'ประเภทงาน และช่าง',
        body: 'ประเภทงาน: ประเภทงานหลักของงาน · ช่างผู้รับผิดชอบ: ช่างที่รับงานนั้น · ทั้งหมด = ไม่กรอง',
      },
      {
        target: 'field:อาการเสีย',
        title: 'อาการเสีย',
        body: 'งานที่มีอาการนี้ ทั้งที่เป็นอาการหลักและอาการอื่นที่ติ๊กไว้ในงาน',
      },
    ],
    kpis: 'งานที่ดำเนินการ: มีวันที่ซ่อมในช่วงนี้ · ซ่อมสำเร็จ: ที่ซ่อมเสร็จหรือปิดงานแล้ว (ไม่นับยกเลิกซ่อม) · มูลค่างานซ่อมรวม: รวมค่าอะไหล่+บริการ · อัตราซ่อมสำเร็จ: สำเร็จ ÷ ดำเนินการ',
    table:
      'เลขที่งาน วันที่ซ่อม ลูกค้า ค่าอะไหล่+บริการ (ยอดรวมสุทธิของงาน) และสถานะงาน · จอกว้างมี ยี่ห้อ, รุ่น และช่างผู้รับผิดชอบ · จอกว้างมากมี Serial / IMEI',
    file: JOB_FILE,
    read: JOB_SCREENS,
    exportModule: 'Job Management',
  },
  {
    path: '/reports/close-job',
    title: 'รายงานการปิดงานซ่อม',
    answers: 'งานที่ปิดในช่วงวันที่ที่เลือก: ปิดไปกี่งาน รับชำระเท่าไร ใช้เวลาเฉลี่ยกี่วัน (TAT) และส่งคืนลูกค้าทางไหน',
    dates: {
      from: 'วันที่ปิดงาน (ตั้งแต่)',
      to: 'วันที่ปิดงาน (ถึง)',
      body: 'นับตามวันที่ปิดงาน เฉพาะงานที่ตอนนี้อยู่ในสถานะปิดงาน',
    },
    filters: [
      {
        target: 'field:วิธีการส่งคืน|เลขที่งาน',
        title: 'วิธีการส่งคืน และเลขที่งาน',
        body: 'วิธีการส่งคืน: วิธีที่ส่งเครื่องคืนลูกค้า · เลขที่งาน: พิมพ์ทั้งหมดหรือบางส่วน ช่องนี้ค้นชื่อลูกค้า เบอร์โทร เลขคำสั่งซื้อ รุ่น IMEI / Serial ได้ด้วย',
        example: 'J2612164',
      },
    ],
    kpis: 'งานที่ปิดแล้ว: ในช่วงนี้ · ยอดรับชำระรวม: ผลรวมยอดที่มากกว่า 0 (ไม่หักยอดคืนเงิน) · TAT เฉลี่ย (วัน): วันปิดงาน − วันเปิดงาน เฉลี่ยทุกงาน · เกิน 30 วัน: งานที่ TAT มากกว่า 30 วัน',
    table:
      'เลขที่งาน วันที่ปิดงาน ลูกค้า TAT (วัน) (แดง = เกิน 10 วัน) ยอดรับชำระ และสถานะงาน · จอกว้างมี วันที่เปิดงาน ยี่ห้อ, รุ่น และวิธีส่งคืน',
    noSort: 'TAT (วัน) ยอดรับชำระ และวิธีส่งคืน',
    file: JOB_FILE,
    read: JOB_SCREENS,
    exportModule: 'Job Management',
  },
  {
    path: '/reports/quotation',
    title: 'รายงานการเสนอราคา',
    answers: 'ใบเสนอราคาที่สร้างในช่วงวันที่ที่เลือก: ออกไปกี่ใบ ลูกค้าตกลงซ่อมกี่ใบ มูลค่ารวมและมูลค่าที่ตกลงเท่าไร',
    dates: { from: 'วันที่สร้าง (ตั้งแต่)', to: 'วันที่สร้าง (ถึง)', body: 'นับตามวันที่สร้างใบเสนอราคา' },
    filters: [
      {
        target: 'field:ประเภท|สถานะ',
        title: 'ประเภท และสถานะ',
        body: 'ประเภท: Type A (Normal) หรือ Type B (VIP) — ทั้งหมด = ทุกประเภท · สถานะ: สถานะของใบตอนนี้ เช่น รอเสนอราคา ลูกค้าตกลงซ่อม',
      },
    ],
    kpis: 'ใบเสนอราคาทั้งหมด: ในช่วงนี้ · ลูกค้าตกลงซ่อม: รวม "…รอชำระเงิน" และ "…รออะไหล่" · มูลค่ารวม: ยอดสุทธิ ไม่รวมใบที่ยกเลิก (ยอดยกเลิกแสดงใต้ตัวเลข) · มูลค่าที่ตกลง: ของใบที่ตกลงซ่อม',
    table: 'เลขที่ใบเสนอราคา วันที่ ลูกค้า จำนวนเงิน (ยอดสุทธิ) และสถานะ · จอกว้างมี ประเภท และอ้างถึงงานซ่อม',
    file: 'ไฟล์มีคอลัมน์เพิ่ม เช่น ส่วนลด, VAT, วันที่ลูกค้าตกลง, ผู้สร้าง',
    read: ['Quotation'],
    exportModule: 'Quotation',
  },
  {
    path: '/reports/sale-order',
    title: 'รายงานการขาย',
    answers:
      'ใบสั่งขายในช่วงวันที่ที่เลือก: ออกไปกี่ใบ อนุมัติแล้วกี่ใบ ยอดขายเท่าไร แยกดูตามพนักงานขายหรือสถานะอนุมัติได้',
    dates: { from: 'วันที่สั่งขาย (ตั้งแต่)', to: 'วันที่สั่งขาย (ถึง)', body: 'นับตามวันที่สร้างใบสั่งขาย' },
    filters: [
      {
        target: 'field:พนักงานขาย|สถานะอนุมัติ',
        title: 'พนักงานขาย และสถานะอนุมัติ',
        body: 'พนักงานขาย: ผู้ขายที่ระบุในใบสั่งขาย · สถานะอนุมัติ: รออนุมัติ อนุมัติแล้ว ปฏิเสธ ส่งกลับแก้ไข หรือกำลังดำเนินการจัดทำ · ทั้งหมด = ไม่กรอง',
      },
    ],
    kpis: 'ใบสั่งขายทั้งหมด: ทุกสถานะในช่วงนี้ · อนุมัติแล้ว: จำนวนใบ · ยอดขายรวม: ยอดสุทธิของใบที่อนุมัติแล้ว (ใบอื่นแสดงใต้ตัวเลข) · ยอดเฉลี่ย/ใบ: ยอดขายรวม ÷ ใบที่อนุมัติแล้ว',
    table:
      'SO No. วันที่สั่ง ชื่อลูกค้า จำนวนเงิน (ยอดสุทธิ) และสถานะอนุมัติ · จอกว้างมี พนักงานขาย · จอกว้างมากมี TrackingNo',
    file: 'ไฟล์มีคอลัมน์เพิ่ม เช่น วิธีชำระ, ผู้อนุมัติ, เอกสารจ่ายสต๊อก',
    read: ['Sale Order', 'Product Pick Stock'],
    exportModule: 'Sale Order',
  },
  {
    path: '/reports/product-used',
    title: 'รายงานการเบิกจ่ายอะไหล่',
    answers:
      'อะไหล่ที่จ่ายออกจากสต๊อกในช่วงวันที่ที่เลือก ทั้งตามงานซ่อม ใบสั่งขาย และจ่ายออกอื่นๆ หักที่รับคืน: ใช้ไปกี่ชิ้น มูลค่าเท่าไร ตัวไหนใช้มากสุด',
    dates: { from: 'วันที่ (ตั้งแต่)', to: 'วันที่ (ถึง)', body: 'นับตามวันที่ของเอกสารจ่ายออก / รับคืน' },
    filters: [
      {
        target: 'field:หมวดหมู่|รหัสอะไหล่',
        title: 'หมวดหมู่ และรหัสอะไหล่',
        body: 'หมวดหมู่: หมวดของอะไหล่ · รหัสอะไหล่: พิมพ์ทั้งหมดหรือบางส่วน ช่องนี้ค้นชื่ออะไหล่และเลขเอกสารได้ด้วย',
        example: 'P02534',
      },
    ],
    kpis: 'รายการเคลื่อนไหว: บรรทัดจ่ายออกและรับคืน · จำนวนที่เบิกสุทธิ: จ่ายออก − รับคืน · มูลค่าสุทธิ: จำนวน × ราคาตอนเบิก (ไม่มีใช้ราคาขายปัจจุบัน) · อะไหล่ที่ใช้บ่อยสุด: สุทธิมากสุด',
    table:
      'Document No. วันที่ รหัสอะไหล่ ชื่ออะไหล่ จำนวน (รับคืนเป็นติดลบ) และมูลค่า — มี * คือใช้ราคาปัจจุบัน · จอกว้างมี ประเภทเอกสาร · จอกว้างมากมี ผู้ทำรายการ',
    file: 'ไฟล์มีคอลัมน์เพิ่ม: อ้างอิง, หมวดหมู่, ราคาต่อหน่วย, ที่มาราคา',
    read: null,
    exportModule: 'Report',
  },
  {
    path: '/reports/product-onhand',
    title: 'รายงานอะไหล่คงเหลือ',
    answers:
      'อะไหล่ที่เปิดใช้งานอยู่ทุกตัว ยอด ณ ตอนนี้ (ไม่มีช่วงวันที่): เหลือกี่ชิ้น มูลค่าสต๊อกเท่าไร ตัวไหนใกล้หมดหรือหมดแล้ว',
    filters: [
      {
        target: 'field:หมวดหมู่|ยี่ห้อ',
        title: 'หมวดหมู่ และยี่ห้อ',
        body: 'เลือกหมวดหมู่หรือยี่ห้อของอะไหล่ · ทั้งหมด = ไม่กรอง',
      },
      {
        target: 'field:สถานะสต๊อก|รหัส / ชื่ออะไหล่',
        title: 'สถานะสต๊อก และรหัส / ชื่อ',
        body: 'สถานะสต๊อก: มีสินค้า = เหลือเกิน 3 ชิ้น · ใกล้หมด (≤3) = เหลือ 1–3 ชิ้น · หมดสต๊อก = 0 หรือติดลบ · รหัส / ชื่ออะไหล่: พิมพ์รหัส (ระบบหรือผู้ผลิต) ชื่อ ยี่ห้อ หรือหมวดหมู่ บางส่วนก็ได้',
        example: 'P02534',
      },
    ],
    kpis: 'จำนวนคงเหลือรวม: ไม่นับที่ติดลบ · มูลค่าสต๊อกรวม: คงเหลือ × ราคาขาย (ไม่มีราคาไม่รวม) · ใกล้หมด (≤ 3): รายการที่เหลือ 1–3 ชิ้น · หมดสต๊อก: รายการที่เหลือ 0 หรือติดลบ',
    table:
      'รหัส (ระบบ) ชื่ออะไหล่ คงเหลือ (สีแดง = 0 · สีส้ม = ไม่เกิน 3 หรือติดลบ) ราคา/หน่วย และมูลค่าคงเหลือ · จอกว้างมี หมวดหมู่ และยี่ห้อ · จอกว้างมากมี รหัส (ผู้ผลิต)',
    file: 'ไฟล์มีคอลัมน์เพิ่ม: รับเข้า / จ่ายออกสะสม, ราคาทุน (ผู้มีสิทธิ์)',
    read: null,
    exportModule: 'Product',
  },
];

export const REPORTS_TOURS: Record<string, Tour> = {
  '/reports': {
    title: 'รายงาน',
    steps: [
      {
        title: 'รายงานทั้งหมดอยู่ที่นี่',
        body: 'เลือกรายงานที่ต้องการ แล้วกำหนดเงื่อนไข ดูตัวเลขสรุป และส่งออกเป็น Excel หรือพิมพ์ / PDF ได้ในหน้ารายงานนั้น',
      },
      {
        target: 'main div.grid:has(> a)',
        title: 'เลือกรายงาน',
        body: 'การ์ดละ 1 รายงาน: การเปิดงานซ่อม · การซ่อม · การปิดงานซ่อม (TAT) · การเสนอราคา · การขาย · การเบิกจ่ายอะไหล่ · อะไหล่คงเหลือ — จบบทสอนแล้วกดการ์ดเพื่อเปิด',
        look: true,
      },
      {
        title: 'ทุกรายงานใช้แบบเดียวกัน',
        body: 'เงื่อนไขการออกรายงาน → กด "ค้นหา" → ตัวเลขสรุปและตาราง → พิมพ์รายงาน / Excel / PDF ด้านบน · รายงานงานซ่อม เสนอราคา และการขาย ต้องมีสิทธิ์ดูเมนูนั้นด้วยจึงเห็นตาราง · ในหน้ารายงานกด ? เพื่อดูบทสอนของรายงานนั้น',
      },
    ],
  },
  ...Object.fromEntries(REPORTS.map((r) => [r.path, reportTour(r)])),
};
