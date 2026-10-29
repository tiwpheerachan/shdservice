'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, RotateCcw } from 'lucide-react';
import { DataTable, type Column } from '@/components/ui/data-table';
import { PageHeader } from './page-header';
import { RowActions } from './row-actions';
import { FilterBar } from './filter-bar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Field, FieldGrid } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import type { MasterRow } from '@/data/types';
import { postJson, errMsg, exportXlsx, isStale } from '@/lib/api';
import { useTable } from '@/data/db';
import { useAccess } from '@/lib/use-access';
import { useFormErrors, useClearOnChange } from '@/lib/use-form-errors';
import { MASTER_DETAIL_MAX, masterSchema } from '@/lib/validation/admin';
import { ExportButton } from '@/components/shared/export-button';
import { useFilterDraft } from '@/lib/use-filter-draft';
import { useTourRestore } from '@/components/tour/tour';

/** API resource name of the master (= /api/masters/<kind>, /api/admin/records table) */
export type MasterKind = 'categories' | 'manufacturers' | 'colors' | 'job_types' | 'product_types' | 'symptoms';

export type MasterConfig = {
  kind: MasterKind;
  title: string;
  description: string;
  nameLabel: string;
  detailLabel?: string;
  extraLabel?: string;
  extraOptions?: string[];
  /** a whole-number days field (job types: SLA) — its label, and the hint under it */
  daysLabel?: string;
  daysHint?: string;
  rows: (MasterRow & { group?: string })[];
};

export function MasterTable({ config }: { config: MasterConfig }) {
  const { push } = useToast();
  const confirm = useConfirm();
  const { isAdmin } = useAccess();
  const router = useRouter();
  // รายการที่ลบ (System Admin): the deleted rows, loaded only while shown; กู้คืน puts one back
  const [view, setView] = React.useState<'active' | 'deleted'>('active');
  const deleted = useTable<MasterRow & { group?: string }>(
    config.kind,
    undefined,
    'only',
    {},
    undefined,
    view === 'deleted',
  );
  // local copy for instant feedback after a save; a fresh list from the server replaces it
  // (adjusted while rendering when config.rows changes — not in an effect pass)
  const [rows, setRows] = React.useState(config.rows);
  const [rowsFrom, setRowsFrom] = React.useState(config.rows);
  if (config.rows !== rowsFrom) {
    setRowsFrom(config.rows);
    setRows(config.rows);
  }
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<(MasterRow & { group?: string }) | null>(null);
  const [form, setForm] = React.useState({ name: '', status: 'Active', group: '', detail: '', days: '' });
  const [saving, setSaving] = React.useState(false);

  // filter bar (ชื่อ + สถานะ) — applied on ค้นหา; the lists are small so this is done in the browser
  type MasterFilter = { name: string; status: '' | 'Active' | 'Inactive' };
  const NO_FILTER: MasterFilter = { name: '', status: '' };
  const { draft, setD, filters: filter, apply, reset } = useFilterDraft<MasterFilter>(NO_FILTER);
  const visible = React.useMemo(() => {
    const term = filter.name.trim().toLowerCase();
    return (view === 'deleted' ? deleted.data : rows).filter(
      (r) =>
        (!term || r.name.toLowerCase().includes(term)) &&
        (view === 'deleted' || !filter.status || r.status === filter.status),
    );
  }, [rows, filter, view, deleted.data]);

  // group options = configured list ∪ values already in the DB
  const groupOptions = React.useMemo(() => {
    const set = new Set<string>(['', ...(config.extraOptions ?? [])]);
    for (const r of rows) if (r.group) set.add(r.group);
    return Array.from(set);
  }, [rows, config.extraOptions]);

  const fe = useFormErrors();
  useClearOnChange(fe.clear, form);
  useTourRestore(() => form, setForm); // a บทสอน puts back what was tried in the dialog
  const openNew = () => {
    setEditing(null);
    setForm({ name: '', status: 'Active', group: '', detail: '', days: config.daysLabel ? '7' : '' });
    fe.setErrors({});
    setOpen(true);
  };
  const openEdit = (r: MasterRow & { group?: string }) => {
    setEditing(r);
    setForm({
      name: r.name,
      status: r.status,
      group: r.group ?? '',
      detail: r.detail ?? '',
      days: r.days != null ? String(r.days) : '',
    });
    fe.setErrors({});
    setOpen(true);
  };

  const upsertRow = (row: MasterRow & { group?: string }) =>
    setRows((s) => (s.some((x) => x.id === row.id) ? s.map((x) => (x.id === row.id ? row : x)) : [...s, row]));

  const save = async () => {
    const schema = masterSchema(config.nameLabel, {
      days: !!config.daysLabel,
      detailMax: MASTER_DETAIL_MAX[config.kind],
    });
    if (fe.report(fe.run(schema, form))) return; // the API checks the same
    setSaving(true);
    try {
      const d = await postJson<{ row: MasterRow & { group?: string } }>(`/api/masters/${config.kind}`, {
        id: editing?.id,
        // the row as the dialog loaded it: another admin's save since → 409 stale instead of being overwritten
        expect: editing && { name: editing.name, detail: editing.detail ?? '', status: editing.status },
        name: form.name.trim(),
        detail: form.detail,
        group: form.group,
        ...(config.daysLabel ? { days: form.days } : {}),
        status: form.status,
      });
      upsertRow(d.row);
      setOpen(false);
      push({
        kind: 'success',
        title: editing ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มข้อมูลใหม่แล้ว',
        desc: `${config.title} — ${d.row.name}`,
      });
    } catch (e) {
      if (isStale(e)) router.refresh(); // the list as stored now
      if (!fe.fromApi(e)) push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  const restore = async (r: MasterRow) => {
    const ok = await confirm({
      title: `กู้คืน${config.title} "${r.name}"?`,
      description: 'รายการนี้จะกลับมาในหน้านี้และเป็นตัวเลือกในทุกฟอร์มอีกครั้ง',
      confirmLabel: 'กู้คืน',
    });
    if (!ok) return;
    try {
      await postJson('/api/admin/records', { table: config.kind, id: r.id, status: 'ACTIVE' });
      push({ kind: 'success', title: 'กู้คืนแล้ว', desc: r.name });
      deleted.refetch();
      router.refresh();
    } catch (e) {
      push({ kind: 'error', title: 'กู้คืนไม่สำเร็จ', desc: errMsg(e) });
    }
  };

  // สถานะ = is_active ในตารางเดิม (Inactive = ซ่อนจาก dropdown ทุกหน้า)
  const toggleStatus = async (id: string) => {
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    const next = r.status === 'Active' ? 'Inactive' : 'Active';
    const ok = await confirm({
      title: `เปลี่ยนสถานะ "${r.name}" เป็น ${next}?`,
      description:
        next === 'Inactive'
          ? 'รายการนี้จะไม่แสดงเป็นตัวเลือกในทุกฟอร์ม ข้อมูลเก่าที่เคยใช้ค่านี้ยังแสดงชื่อได้ตามเดิม'
          : 'รายการนี้จะกลับมาเป็นตัวเลือกในทุกฟอร์ม',
      confirmLabel: next === 'Inactive' ? 'ปิดใช้งาน' : 'เปิดใช้งาน',
    });
    if (!ok) return;
    try {
      await postJson('/api/admin/records', {
        table: config.kind,
        id,
        status: next === 'Inactive' ? 'INACTIVE' : 'ACTIVE',
      });
      setRows((s) => s.map((x) => (x.id === id ? { ...x, status: next } : x)));
      push({ kind: 'success', title: 'เปลี่ยนสถานะเรียบร้อย', desc: `${r.name} → ${next}` });
    } catch (e) {
      push({ kind: 'error', title: 'เปลี่ยนสถานะไม่สำเร็จ', desc: errMsg(e) });
    }
  };

  const remove = async (r: MasterRow) => {
    if (!isAdmin) return; // the delete button only shows for an admin
    const ok = await confirm({
      tone: 'danger',
      title: `ลบ${config.title} "${r.name}"?`,
      description: (
        <>
          รายการนี้จะหายจากหน้านี้และจากตัวเลือกในทุกฟอร์ม ข้อมูลเก่าที่เคยใช้ค่านี้ยังแสดงชื่อได้ตามเดิม
          <br />
          กู้คืนได้จากแท็บ "รายการที่ลบ" — ถ้าแค่ต้องการหยุดใช้ชั่วคราว ให้เปลี่ยนสถานะเป็น Inactive แทน
        </>
      ),
      confirmLabel: 'ลบ',
    });
    if (!ok) return;
    try {
      await postJson('/api/admin/records', { table: config.kind, id: r.id, status: 'DELETED' });
      setRows((s) => s.filter((x) => x.id !== r.id));
      push({ kind: 'success', title: 'ลบข้อมูลแล้ว', desc: r.name });
    } catch (e) {
      push({ kind: 'error', title: 'ลบไม่สำเร็จ', desc: errMsg(e) });
    }
  };

  const columns: Column<MasterRow & { group?: string }>[] = [
    {
      key: 'no',
      header: '#',
      width: '56px',
      align: 'center',
      sortable: false,
      cell: (_r, i) => <span className="num text-muted-foreground">{i + 1}</span>,
    },
    {
      key: 'name',
      header: config.nameLabel,
      cell: (r) => <span className="font-medium">{r.name}</span>,
    },
    ...(config.detailLabel
      ? [
          {
            key: 'detail',
            header: config.detailLabel,
            hideBelow: 'md' as const,
            cell: (r: MasterRow) => <span className="text-muted-foreground">{r.detail || '—'}</span>,
          },
        ]
      : []),
    ...(config.daysLabel
      ? [
          {
            key: 'days',
            header: config.daysLabel,
            align: 'right' as const,
            value: (r: MasterRow & { group?: string }) => r.days ?? 0,
            cell: (r: MasterRow & { group?: string }) => <span className="num">{r.days ?? '—'}</span>,
          },
        ]
      : []),
    ...(config.extraLabel
      ? [
          {
            key: 'group',
            header: config.extraLabel,
            hideBelow: 'lg' as const,
            cell: (r: MasterRow & { group?: string }) => <Badge tone="info">{r.group}</Badge>,
          },
        ]
      : []),
    {
      key: 'status',
      header: 'สถานะ',
      width: '110px',
      cell: (r) =>
        view === 'deleted' ? (
          <Badge tone="neutral">ลบแล้ว</Badge>
        ) : (
          // a switch: its state is announced (on = Active), not only shown by the badge's colour / text;
          // min-h-6 = a 24px target, -my-0.5 keeps the row its height; on touch screens 44px, the -my-2.5
          // taking it into the cell's padding (still no taller row)
          <button
            type="button"
            role="switch"
            aria-checked={r.status === 'Active'}
            aria-label={`${r.status} — สถานะของ ${r.name}`}
            onClick={() => toggleStatus(r.id)}
            title="คลิกเพื่อสลับสถานะ"
            className="-my-0.5 inline-flex min-h-6 items-center rounded-full pointer-coarse:-my-2.5 pointer-coarse:min-h-11"
          >
            <Badge tone={r.status === 'Active' ? 'success' : 'neutral'} dot>
              {r.status}
            </Badge>
          </button>
        ),
    },
    {
      key: 'action',
      header: 'Action',
      width: '110px',
      align: 'center',
      sortable: false,
      cell: (r) =>
        view === 'deleted' ? (
          <Button variant="outline" size="sm" onClick={() => restore(r)}>
            <RotateCcw className="h-3.5 w-3.5" />
            กู้คืน
          </Button>
        ) : (
          <RowActions onEdit={() => openEdit(r)} onDelete={isAdmin ? () => remove(r) : undefined} />
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={config.title}
        description={config.description}
        actions={
          <>
            <ExportButton
              run={() => exportXlsx(config.kind, { deleted: 'exclude', q: filter.name, status: filter.status })}
            />
            <Button size="sm" onClick={openNew}>
              <Plus className="h-3.5 w-3.5" />
              เพิ่มข้อมูล
            </Button>
          </>
        }
      />

      {isAdmin && (
        <div className="mb-3 inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-sm">
          {(['active', 'deleted'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={
                'rounded-md px-3.5 py-1.5 font-medium transition-colors ' +
                (view === v ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')
              }
            >
              {v === 'active' ? 'รายการ' : 'รายการที่ลบ'}
            </button>
          ))}
        </div>
      )}

      <FilterBar onSearch={apply} onReset={reset}>
        <Field label={config.nameLabel}>
          <Input
            placeholder={`พิมพ์บางส่วนของ${config.nameLabel}`}
            value={draft.name}
            onChange={(e) => setD('name', e.target.value)}
          />
        </Field>
        <Field label="สถานะ">
          <Select value={draft.status} onChange={(e) => setD('status', e.target.value as MasterFilter['status'])}>
            <option value="">ทั้งหมด</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </Select>
        </Field>
      </FilterBar>

      <DataTable
        searchable={false}
        columns={columns}
        rows={visible}
        loading={view === 'deleted' && deleted.loading}
        error={view === 'deleted' ? deleted.error : null}
        onRetry={deleted.refetch}
        rowKey={(r) => r.id}
        footerNote={
          <span className="hidden sm:inline">
            · Active {visible.filter((r) => r.status === 'Active').length} รายการ
          </span>
        }
      />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `แก้ไข${config.title}` : `เพิ่ม${config.title}`}
        description="กรอกข้อมูลให้ครบถ้วน ช่องที่มี * จำเป็นต้องระบุ"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              บันทึกข้อมูล
            </Button>
          </>
        }
      >
        <FieldGrid cols={2}>
          <Field label={config.nameLabel} required error={fe.errors.name} hint={`${form.name.length}/50 ตัวอักษร`}>
            <Input
              value={form.name}
              maxLength={50}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={config.nameLabel}
            />
          </Field>
          <Field label="สถานะ" required>
            <Select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              <option>Active</option>
              <option>Inactive</option>
            </Select>
          </Field>
          {config.daysLabel && (
            <Field label={config.daysLabel} required error={fe.errors.days} hint={config.daysHint}>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                step={1}
                className="num"
                value={form.days}
                onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))}
              />
            </Field>
          )}
          {config.extraLabel && (
            <Field label={config.extraLabel} error={fe.errors.group}>
              {/* พิมพ์กลุ่มใหม่ได้ + เลือกจากค่าที่มีอยู่แล้วใน DB (datalist) */}
              <Input
                list={`${config.kind}-group-options`}
                maxLength={50}
                value={form.group}
                onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))}
                placeholder="- - ไม่ระบุ - -"
              />
              <datalist id={`${config.kind}-group-options`}>
                {groupOptions.filter(Boolean).map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </Field>
          )}
          {config.detailLabel && (
            <Field label={config.detailLabel} wide error={fe.errors.detail}>
              <Textarea
                maxLength={MASTER_DETAIL_MAX[config.kind]}
                value={form.detail}
                onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))}
                rows={3}
              />
            </Field>
          )}
        </FieldGrid>
      </Modal>
    </>
  );
}
