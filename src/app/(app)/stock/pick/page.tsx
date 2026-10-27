'use client';

import * as React from 'react';
import { Save, Search } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Field, FieldGrid, ReadOnly } from '@/components/ui/field';
import { Input, Select, NumberInput } from '@/components/ui/input';
import { SearchSelect, strOptions } from '@/components/shared/search-select';
import { matchProducts } from '@/lib/product-match';
import { useToast } from '@/components/ui/toast';
import { useApi, useProducts, useJobNos, useStaff } from '@/data/db';
import { STOCK_PICK_TYPES } from '@/data/options';
import { int, cn } from '@/lib/utils';
import { api, postJson, errMsg, qs } from '@/lib/api';
import { useMountTime } from '@/lib/use-client';
import { isoDateTime } from '@/lib/dates';
import { useClearOnChange, useFormErrors } from '@/lib/use-form-errors';
import { issueSchema } from '@/lib/validation/stock';
import { STORE_LOCATION_NAME } from '@/lib/status-ids';
import { useTourRestore } from '@/components/tour/tour';

const DOC_TYPES = STOCK_PICK_TYPES; // = inventory_type 3 / 4 / 5
/** รับคืนจากการเบิก is by job: a WHO document no. (or a job nothing went out to) has nothing to return */
const RETURN_REF_HINT = 'ใส่เลขงาน (J…) ที่เคยเบิกอะไหล่ — ไม่ใช่เลขเอกสารจ่ายออก (WHO…)';

type Line = {
  docNo: string;
  code: string;
  name: string;
  pickStatus: string;
  onhand: number;
  need: number;
  issue: number;
  logId?: number; // job_order_spare_part_log id (จ่ายออกตามงานซ่อม)
  dtId?: number; // sale_out_dt id (จ่ายออกตามใบสั่งขาย)
};

type PartLine = {
  logId: number;
  jobNo: string;
  code: string;
  name: string;
  onhand: number;
  need: number;
  status: string;
};
type SoLine = {
  dtId: number;
  code: string;
  name: string;
  onhand: number;
  need: number;
  picked: boolean;
  pickNo: string;
};
type ReturnLine = {
  logId: number;
  jobNo: string;
  code: string;
  name: string;
  onhand: number;
  granted: number;
  returned: number;
  returnable: number;
  status: string;
};

export default function PickPage() {
  const { push } = useToast();
  const fe = useFormErrors(); // same as every form: the error under its field, focus, one summary toast
  // งานที่ยังไม่ปิด/ไม่ยกเลิกที่มีรายการค้างเบิก / งานที่มีอะไหล่จ่ายไปแล้วให้รับคืน (รับคืนได้ทุกสถานะงาน)
  const { data: PENDING_JOB_NOS, ...pendingLookup } = useJobNos(300, 'pending_parts');
  const { data: RETURNABLE_JOB_NOS, ...returnableLookup } = useJobNos(300, 'returnable');
  // ใบสั่งขายที่อนุมัติแล้วแต่ยังมีรายการค้างจ่าย (อนุมัติ = ตัดสต๊อกให้แล้ว จึงมักว่าง)
  const pickOrders = useApi<{ rows: string[] }>('/api/stock/pick-orders', { fresh: true });
  const SALE_ORDERS = pickOrders.data?.rows ?? [];
  const { data: STAFF, ...staffLookup } = useStaff();
  const [saving, setSaving] = React.useState(false);

  const [docType, setDocType] = React.useState(DOC_TYPES[0]);
  const [ref, setRef] = React.useState('');
  const [lines, setLines] = React.useState<Line[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [find, setFind] = React.useState(''); // จ่ายออกอื่นๆ: narrows the shown lines (typed quantities stay)
  const [payTo, setPayTo] = React.useState('');
  const [remark, setRemark] = React.useState('');
  // บทสอน: the document type, its reference, the lines (Get Data / quantities) and the footer go back
  useTourRestore(
    () => ({ docType, ref, lines, loaded, find, payTo, remark }),
    (v) => {
      setDocType(v.docType);
      setRef(v.ref);
      setLines(v.lines);
      setLoaded(v.loaded);
      setFind(v.find);
      setPayTo(v.payTo);
      setRemark(v.remark);
    },
  );
  // document date preview: when the screen opened, Thai time (browser only — no hydration mismatch)
  const openedAt = useMountTime();
  const docDate = openedAt ? isoDateTime(openedAt, { seconds: true }) : '';

  const kind: 'job' | 'sale' | 'other' | 'return' =
    docType === 'จ่ายออกตามงานซ่อม'
      ? 'job'
      : docType === 'จ่ายออกตามใบสั่งขาย'
        ? 'sale'
        : docType === 'รับคืนจากการเบิก'
          ? 'return'
          : 'other';
  // the whole catalog only for จ่ายออกอื่นๆ (its lines ARE the in-stock parts) — the other types read their
  // lines from the reference document
  const {
    data: PRODUCTS,
    loading: productsLoading,
    error: productsError,
    refetch: refetchProducts,
  } = useProducts(kind === 'other');
  // อ้างอิง: งานที่ค้างเบิก / งานที่รับคืนได้ / ใบสั่งขายที่รอจ่าย / (อื่นๆ ไม่ต้องอ้างอิง)
  const refOptions =
    kind === 'job' ? PENDING_JOB_NOS : kind === 'return' ? RETURNABLE_JOB_NOS : kind === 'sale' ? SALE_ORDERS : [];
  const refLookup =
    kind === 'job'
      ? pendingLookup
      : kind === 'return'
        ? returnableLookup
        : kind === 'sale'
          ? { error: pickOrders.error, refetch: () => void pickOrders.mutate() }
          : undefined;
  const isReturn = kind === 'return';
  // จ่ายออกอื่นๆ takes parts out of the store — never back to it (the API refuses it too)
  const RECIPIENTS = React.useMemo(
    () => [...(kind === 'other' ? [] : [STORE_LOCATION_NAME]), ...STAFF.map((s) => s.name)],
    [STAFF, kind],
  );

  // another document type → its reference and lines start over (the change event does it)
  const changeDocType = (t: string) => {
    setDocType(t);
    setPayTo((p) => (p === STORE_LOCATION_NAME ? '' : p)); // not a destination of every type (RECIPIENTS)
    setRef('');
    setLines([]);
    setLoaded(false);
    setFind('');
    fe.setErrors({}); // another document → the old one's errors no longer apply
  };

  // ดึงรายการค้างจ่ายของเอกสารอ้างอิงจาก DB
  const getData = async () => {
    if (kind === 'other') {
      if (productsError) {
        push({ kind: 'error', title: 'โหลดรายการอะไหล่ไม่สำเร็จ', desc: productsError });
        refetchProducts();
        return;
      }
      // จ่ายออกอื่นๆ: เลือกจากรายการอะไหล่ทั้งหมด (ใส่จำนวนเฉพาะที่ต้องการจ่าย)
      setLines(
        PRODUCTS.filter((p) => p.onhand > 0).map((p) => ({
          docNo: '-',
          code: p.sysCode,
          name: p.name,
          pickStatus: 'พร้อมจ่าย',
          onhand: p.onhand,
          need: p.onhand,
          issue: 0,
        })),
      );
      setLoaded(true);
      return;
    }
    if (!ref) {
      const e = { ref: 'ต้องเลือกอ้างอิงเลขเอกสาร' };
      fe.setErrors(e);
      fe.report(e);
      return;
    }
    try {
      if (kind === 'return') {
        const d = await api<{ rows: ReturnLine[] }>(`/api/stock/pick-lines${qs({ type: 'return', ref })}`);
        setLines(
          d.rows.map((r) => ({
            docNo: r.jobNo,
            code: r.code,
            name: r.name,
            pickStatus: r.status,
            onhand: r.onhand,
            need: r.returnable,
            issue: 0,
            logId: r.logId,
          })),
        );
        setLoaded(true);
        if (d.rows.length)
          push({ kind: 'success', title: 'ดึงรายการที่รับคืนได้แล้ว', desc: `${ref} — ${d.rows.length} รายการ` });
        else push({ kind: 'info', title: `${ref} ไม่มีอะไหล่ที่รับคืนได้`, desc: RETURN_REF_HINT });
      } else if (kind === 'job') {
        const d = await api<{ rows: PartLine[] }>(`/api/stock/pick-lines${qs({ type: 'job', ref })}`);
        setLines(
          d.rows.map((r) => ({
            docNo: r.jobNo,
            code: r.code,
            name: r.name,
            pickStatus: r.status,
            onhand: r.onhand,
            need: r.need,
            issue: 0,
            logId: r.logId,
          })),
        );
        setLoaded(true);
        push({ kind: 'success', title: 'ดึงรายการเบิกแล้ว', desc: `${ref} — ${d.rows.length} รายการ` });
      } else {
        const d = await api<{ rows: SoLine[] }>(`/api/stock/pick-lines${qs({ type: 'sale', ref })}`);
        const rows = d.rows.filter((r) => !r.picked);
        const done = [...new Set(d.rows.map((r) => r.pickNo).filter(Boolean))];
        setLines(
          rows.map((r) => ({
            docNo: ref,
            code: r.code,
            name: r.name,
            pickStatus: r.onhand === 0 ? 'รออะไหล่' : 'รอจ่าย',
            onhand: r.onhand,
            need: r.need,
            issue: 0,
            dtId: r.dtId,
          })),
        );
        setLoaded(true);
        // 0 lines: say why instead of a green "done" — approving the order already issued its stock
        if (rows.length) push({ kind: 'success', title: 'ดึงรายการแล้ว', desc: `${ref} — ${rows.length} รายการ` });
        else if (done.length)
          push({
            kind: 'info',
            title: 'ไม่มีรายการค้างจ่าย',
            desc: `ใบสั่งขายนี้ตัดสต๊อกตอนอนุมัติแล้ว (${done.join(', ')})`,
          });
        else push({ kind: 'info', title: 'ไม่มีรายการค้างจ่าย', desc: `${ref} ไม่มีรายการสินค้า (มีแต่ค่าบริการ)` });
      }
    } catch (e) {
      push({ kind: 'error', title: 'ดึงรายการไม่สำเร็จ', desc: errMsg(e) });
    }
  };

  // a quantity over the limit stays as typed and is flagged (never cut down quietly) — the server refuses it too
  const setIssue = (key: number | string, v: number) =>
    setLines((s) => s.map((l) => ((l.logId ?? l.dtId ?? l.code) === key ? { ...l, issue: Math.max(0, v) } : l)));
  const maxOf = (l: Line) => (isReturn ? l.need : Math.min(l.need, l.onhand));
  const overMsg = (l: Line) =>
    l.issue <= maxOf(l)
      ? ''
      : l.issue > l.need
        ? `เกินจำนวน${isReturn ? 'ที่รับคืนได้' : kind === 'other' ? 'คงเหลือ' : 'ที่ขอ'} (เหลือ ${int(l.need)})`
        : `เกินจำนวนคงเหลือในสต๊อก (มี ${int(l.onhand)})`;
  const overCount = lines.filter((l) => l.issue > maxOf(l)).length;

  const totalIssue = lines.reduce((s, l) => s + l.issue, 0);
  const term = find.trim().toLowerCase();
  // the same word search as the product pickers (code / part no / TH-EN-CN name / brand), plus the line's own name
  const hit = React.useMemo(
    () => (term ? new Set(matchProducts(PRODUCTS, term, Infinity).map((p) => p.sysCode)) : null),
    [PRODUCTS, term],
  );
  const shown = hit
    ? lines.filter((l) => hit.has(l.code) || l.code.toLowerCase().includes(term) || l.name.toLowerCase().includes(term))
    : lines;
  const columns: Column<Line>[] = [
    { key: 'i', header: '#', width: '40px', align: 'center', sortable: false, cell: (_, i) => i + 1 },
    { key: 'docNo', header: 'Document No.', cell: (l) => <span className="num">{l.docNo}</span> },
    { key: 'code', header: 'Item Code', cell: (l) => <span className="num font-medium">{l.code}</span> },
    {
      key: 'name',
      header: 'Item Name',
      cell: (l) => <span className="line-clamp-1 max-w-[320px]">{l.name}</span>,
    },
    {
      key: 'pickStatus',
      header: 'สถานะการเบิก',
      cell: (l) => (
        <Badge tone={l.pickStatus === 'รออะไหล่' ? 'danger' : isReturn ? 'info' : 'warning'} dot>
          {l.pickStatus}
        </Badge>
      ),
    },
    {
      key: 'onhand',
      header: 'คงเหลือ',
      align: 'right',
      cell: (l) => (
        <span className={cn('font-medium', l.onhand === 0 ? 'text-danger' : l.onhand <= 3 ? 'text-warning' : '')}>
          {int(l.onhand)}
        </span>
      ),
    },
    { key: 'need', header: isReturn ? 'รับคืนได้' : 'ต้องการ', align: 'right', cell: (l) => int(l.need) },
    {
      key: 'issue',
      header: isReturn ? 'จำนวนรับคืน' : 'จำนวนจ่ายออก',
      align: 'right',
      sortable: false,
      cell: (l) => (
        <>
          <NumberInput
            aria-label={`${isReturn ? 'จำนวนรับคืน' : 'จำนวนจ่ายออก'} ${l.code}`}
            min={0}
            max={maxOf(l)}
            aria-invalid={!!overMsg(l) || undefined}
            placeholder="0"
            value={l.issue}
            disabled={!isReturn && l.onhand === 0}
            onChange={(n) => setIssue(l.logId ?? l.dtId ?? l.code, n)}
            className="ml-auto h-8 w-24"
          />
          {overMsg(l) && (
            <p role="alert" className="mt-1 text-2xs text-danger">
              {overMsg(l)}
            </p>
          )}
        </>
      ),
    },
  ];
  useClearOnChange(fe.clear, { ref, payTo, lines: totalIssue }); // a value that changes takes its error away

  // WHO document (type 3/4/5) → inventory_hd/dt + quantity_used/remain (+ grant on ใบเบิก)
  const save = async () => {
    const body = {
      type: kind,
      ref,
      payTo,
      remark,
      lines: lines
        .filter((l) => l.issue > 0)
        .map((l) => ({ logId: l.logId, dtId: l.dtId, code: l.code, qty: l.issue })),
    };
    // the API's rules (lib/validation/stock); the lines message names what this screen asks for
    const e = { ...fe.run(issueSchema, body) };
    if (totalIssue === 0)
      e.lines = isReturn ? 'ต้องระบุจำนวนรับคืนอย่างน้อย 1 รายการ' : 'ต้องระบุจำนวนจ่ายออกอย่างน้อย 1 รายการ';
    else if (overCount) e.lines = `จำนวนเกิน ${overCount} รายการ — แก้ช่องที่มีข้อความสีแดงก่อนบันทึก`;
    fe.setErrors(e);
    if (fe.report(e)) return;
    setSaving(true);
    try {
      const d = await postJson<{ no: string; total: number }>('/api/stock/issue', body);
      push({
        kind: 'success',
        title: isReturn ? `บันทึกการรับคืนแล้ว ${d.total} ชิ้น` : `บันทึกการจ่ายออกแล้ว ${d.total} ชิ้น`,
        desc: d.no,
      });
      setLines([]);
      setLoaded(false);
      setRef('');
      setRemark('');
      refetchProducts();
      if (kind === 'sale') pickOrders.mutate();
    } catch (e) {
      if (!fe.fromApi(e)) push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="ตัดจ่ายอะไหล่"
        description="Stock Module » ตัดจ่ายอะไหล่ตามงานซ่อม / ใบสั่งขาย / อื่นๆ และรับคืนอะไหล่ที่จ่ายไปแล้วเข้าคลัง"
      />

      {/* document header */}
      <div className="surface p-4">
        <FieldGrid cols={2}>
          <Field label="หมายเลขเอกสาร">
            <ReadOnly>
              <span className="font-medium text-primary">Generate Auto</span>
            </ReadOnly>
          </Field>
          <Field label="วันที่สร้างเอกสาร">
            <ReadOnly>
              <span className="num">{docDate || '—'}</span>
            </ReadOnly>
          </Field>
          <Field label="ประเภทเอกสาร" required>
            <Select value={docType} onChange={(e) => changeDocType(e.target.value)}>
              {DOC_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="อ้างอิงเลขเอกสาร" required={kind !== 'other'} error={fe.errors.ref} lookup={refLookup}>
            <div className="flex gap-2">
              {kind === 'job' || kind === 'return' ? (
                // พิมพ์เลขงานเองได้ + รายการแนะนำ = งานที่ค้างเบิก / รับคืนได้ (ไม่จำกัดแค่ 100 งานล่าสุด)
                <div className="relative flex-1">
                  <Input
                    list="pick-ref-options"
                    value={ref}
                    onChange={(e) => setRef(e.target.value.trim().toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && getData()}
                    placeholder={
                      kind === 'job'
                        ? 'เลือกหรือพิมพ์เลขงานที่ค้างเบิก เช่น J2612088'
                        : 'เลือกหรือพิมพ์เลขงาน (J…) ที่เคยเบิกอะไหล่'
                    }
                    className="num"
                  />
                  <datalist id="pick-ref-options">
                    {refOptions.map((r) => (
                      <option key={r} value={r} />
                    ))}
                  </datalist>
                </div>
              ) : (
                <div className="flex-1">
                  <SearchSelect
                    value={ref}
                    onChange={setRef}
                    options={strOptions(refOptions)}
                    disabled={kind === 'other'}
                    placeholder={
                      kind === 'other'
                        ? '- - ไม่ต้องอ้างอิง - -'
                        : refOptions.length || pickOrders.loading
                          ? '- - เลือกใบสั่งขาย - -'
                          : 'ไม่มีใบสั่งขายที่ค้างจ่าย'
                    }
                    searchPlaceholder="พิมพ์เลขเอกสาร…"
                  />
                </div>
              )}
              <Button size="md" variant="outline" onClick={getData} disabled={kind === 'other' && productsLoading}>
                <Search className="h-3.5 w-3.5" />
                Get Data
              </Button>
            </div>
          </Field>
          {kind === 'sale' && (
            <p role="status" className="col-span-full text-2xs text-muted-foreground">
              {!refOptions.length && !pickOrders.loading
                ? 'ไม่มีใบสั่งขายที่ต้องจ่ายที่นี่ — ใบสั่งขายที่อนุมัติแล้วถูกตัดสต๊อกให้ตอนอนุมัติเรียบร้อย ไม่ต้องจ่ายออกซ้ำ'
                : 'อนุมัติใบสั่งขายแล้วระบบตัดสต๊อกให้ทันที — ที่นี่จึงแสดงเฉพาะใบที่อนุมัติแล้วแต่ยังมีรายการค้างจ่าย'}
            </p>
          )}
        </FieldGrid>
      </div>

      {/* items table — DataTable pages it (จ่ายออกอื่นๆ = every in-stock part, ~hundreds of rows); quantities
          typed on another page or in a row the search hides stay in `lines` and are saved */}
      {fe.errors.lines && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
          {fe.errors.lines}
        </p>
      )}
      <DataTable
        label="รายการเบิกอะไหล่"
        searchable={false}
        toolbar={
          kind === 'other' && lines.length > 0 ? (
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                aria-label="ค้นหาอะไหล่ (รหัส หรือชื่อ)"
                placeholder="ค้นหารหัส หรือชื่ออะไหล่…"
                value={find}
                onChange={(e) => setFind(e.target.value)}
                className="h-8 w-72 max-w-full"
              />
            </div>
          ) : undefined
        }
        narrowed={!!term}
        onClearFilters={() => setFind('')}
        columns={columns}
        rows={shown}
        rowKey={(l) => String(l.logId ?? l.dtId ?? l.code)}
        emptyText={
          loaded
            ? kind === 'other'
              ? 'ไม่มีอะไหล่ที่มีของในสต๊อก'
              : isReturn
                ? `ไม่มีอะไหล่ที่รับคืนได้ — ${RETURN_REF_HINT}`
                : 'ไม่มีรายการค้างจ่าย'
            : kind === 'other'
              ? 'กด Get Data เพื่อดึงรายการอะไหล่ที่มีของในสต๊อก'
              : kind === 'sale'
                ? 'เลือกใบสั่งขายแล้วกด Get Data เพื่อดึงรายการ'
                : 'เลือกหรือพิมพ์เลขงานแล้วกด Get Data เพื่อดึงรายการ'
        }
        footerNote={
          lines.length > 0 && (
            <span>
              · {isReturn ? 'รวมจำนวนรับคืน' : 'รวมจำนวนจ่ายออก'}{' '}
              <span className="num font-semibold text-primary">{int(totalIssue)} ชิ้น</span>
            </span>
          )
        }
      />

      {/* footer */}
      <div className="surface p-4">
        <FieldGrid cols={2}>
          <Field label={isReturn ? 'รับคืนจาก' : 'จ่ายให้'} required error={fe.errors.payTo} lookup={staffLookup}>
            <SearchSelect
              value={payTo}
              onChange={setPayTo}
              options={strOptions(RECIPIENTS)}
              searchPlaceholder="พิมพ์ชื่อ…"
            />
          </Field>
          <Field label="หมายเหตุ" wide error={fe.errors.remark} hint={`${remark.length}/100 ตัวอักษร`}>
            <Input
              maxLength={100}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder={isReturn ? 'หมายเหตุการรับคืน…' : 'หมายเหตุการจ่ายออก…'}
            />
          </Field>
        </FieldGrid>
      </div>

      <div className="flex justify-end">
        <Button size="md" onClick={save} disabled={lines.length === 0 || saving}>
          <Save className="h-4 w-4" />
          {isReturn ? 'บันทึกการรับคืน' : 'บันทึกการจ่ายออก'}
        </Button>
      </div>
    </>
  );
}
