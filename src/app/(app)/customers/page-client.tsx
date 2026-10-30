'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { Plus, MapPin, RotateCcw } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { RowActions } from '@/components/shared/row-actions';
import { FilterBar } from '@/components/shared/filter-bar';
import { SearchSelect } from '@/components/shared/search-select';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Field } from '@/components/ui/field';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { dismissToast, useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';

/** the "edited by someone else" toast: one at a time, taken down when the dialog closes or reopens */
const STALE_TOAST = 'customer-stale';
import { CUSTOMER_TYPES } from '@/data/options';
import type { Customer } from '@/data/types';
import { useApi, useCustomersPage, useProvinces } from '@/data/db';
import {
  CustomerFields,
  ConflictNotice,
  EMPTY_CUSTOMER,
  toCustomerForm,
  type CustomerFormValues,
  type CustomerConflict,
} from '@/components/shared/customer-form';
import { api, postJson, errMsg, qs, exportXlsx, ApiError, isStale } from '@/lib/api';
import { useAccess } from '@/lib/use-access';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { useFormErrors, apiFieldErrors, focusFirstInvalid } from '@/lib/use-form-errors';
import { customerSchema } from '@/lib/validation/customer';
import { useServerTable } from '@/lib/use-server-table';
import { NO_FILTER, type CustomerFilter } from './filters';
import { ExportButton } from '@/components/shared/export-button';
import { useTourRestore } from '@/components/tour/tour';
import { Email } from '@/components/shared/email';

function CustomersPageInner() {
  const { push } = useToast();
  const router = useRouter();
  const access = useAccess();
  const { add: canAdd, edit: canEdit, del: canDel } = access.forPath('/customers');
  const confirm = useConfirm();
  const canJobs = access.canPath('/jobs/list'); // ประวัติงานซ่อม opens the job list (Manager has no job view)

  // server-side paging / search over the customer table (43k rows)
  const { draft, setD, filters: filter, apply, reset, narrowed, pageArgs, server } = useServerTable(NO_FILTER);
  const { data: PROVINCES, ...provincesLookup } = useProvinces();
  // แสดงรายการที่ลบ (System Admin): the deleted customers instead of the live list; กู้คืน puts one back
  const [showDeleted, setShowDeleted] = React.useState(false);
  const deletedView = access.isAdmin && showDeleted;
  const {
    rows: CUSTOMERS,
    total,
    loading,
    refetch,
    error: loadError,
  } = useCustomersPage({ ...pageArgs, ...filter }, deletedView ? 'only' : 'exclude');

  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Customer | null>(null);
  const [viewOnly, setViewOnly] = React.useState(false);
  const [form, setForm] = React.useState<CustomerFormValues>(EMPTY_CUSTOMER);
  const [saving, setSaving] = React.useState(false);
  const [conflicts, setConflicts] = React.useState<CustomerConflict[] | null>(null);
  const fe = useFormErrors();
  // บทสอน: what is tried in the เพิ่มลูกค้า dialog goes back before the tour closes it (closing never asks)
  useTourRestore(() => form, setForm);
  // typed into the dialog, not saved yet: a session running out keeps the page (sign in again in a new tab)
  // instead of /login, and a link away asks first — as on every form
  useUnsavedChanges(
    () =>
      open && !viewOnly && JSON.stringify(form) !== JSON.stringify(editing ? toCustomerForm(editing) : EMPTY_CUSTOMER),
  );

  const closeForm = () => {
    setOpen(false);
    dismissToast(STALE_TOAST);
  };
  const openForm = (c: Customer | null, readOnly = false) => {
    dismissToast(STALE_TOAST); // it sat over the dialog's บันทึกข้อมูล button
    setViewOnly(readOnly);
    setEditing(c);
    setConflicts(null);
    fe.setErrors({});
    setForm(c ? toCustomerForm(c) : EMPTY_CUSTOMER);
    setOpen(true);
  };

  // deep links — handled once each, without an effect:
  //   ?edit=<customer uuid> (from the job / quotation / SO forms) → that customer's form (swr answer's callback)
  //   ?new=1&phone=…&name=… → a new customer's form with those filled in (adjusted while rendering)
  const sp = useSearchParams();
  const editId = sp.get('edit')?.trim().toLowerCase() ?? '';
  const editLinkOpened = React.useRef(false);
  useApi<{ rows: Customer[] }>(editId ? `/api/customers/lookup${qs({ q: editId, deleted: 'all' })}` : null, {
    fresh: true,
    onSuccess: (d) => {
      if (editLinkOpened.current) return;
      editLinkOpened.current = true;
      // that customer only — a deleted one (non-admin) is not found, never another one in its place
      const hit = d.rows.find((c) => c.id === editId);
      if (!hit) {
        push({ kind: 'error', title: 'ไม่พบลูกค้า', desc: 'ลิงก์ไม่ถูกต้อง หรือลูกค้าอาจถูกลบแล้ว' });
        return;
      }
      // only an admin gets a deleted one here (deleted=all): it opens to look at, not as an edit that can never save
      void api<{ rows: Customer[] }>(`/api/customers/lookup${qs({ q: editId })}`)
        .then((live) => live.rows.some((c) => c.id === hit.id))
        .catch(() => true)
        .then((alive) => {
          openForm(hit, !canEdit || !alive);
          if (!alive)
            push({
              kind: 'info',
              title: `${hit.code} ถูกลบแล้ว`,
              desc: 'ดูได้อย่างเดียว — กู้คืนได้ที่ "แสดงรายการที่ลบ"',
            });
        });
    },
  });
  const [newLinkHandled, setNewLinkHandled] = React.useState(false);
  if (!editId && sp.get('new') && canAdd && !newLinkHandled) {
    setNewLinkHandled(true);
    openForm(null);
    setForm((f) => ({ ...f, phone: sp.get('phone') ?? '', name: sp.get('name') ?? '' }));
  }

  const save = async () => {
    // an existing customer: values it already had (old data) still save — only changed fields are checked
    if (fe.report(fe.run(customerSchema(editing), form))) return;
    setSaving(true);
    setConflicts(null);
    try {
      const d = await postJson<{ row: Customer }>('/api/customers', { ...form, code: editing?.code || undefined });
      setOpen(false);
      push({ kind: 'success', title: 'บันทึกข้อมูลลูกค้าแล้ว', desc: `${d.row.code} · ${d.row.name}` });
      refetch();
    } catch (e) {
      // 409 = phone / email / tax id already belongs to another customer (server refuses)
      const details = e instanceof ApiError ? (e.details as { conflicts?: CustomerConflict[] } | undefined) : undefined;
      // the notice + the field's own error say it — no toast (it sat on the dialog's บันทึกข้อมูล button)
      if (details?.conflicts?.length) {
        setConflicts(details.conflicts);
        fe.setErrors(apiFieldErrors(e) ?? {});
        focusFirstInvalid();
      } else if (isStale(e) && editing) {
        refetch(); // the list's row is the stored one again — reopening the dialog shows it
        // "โหลดใหม่" reads this customer into the open dialog (a page reload lost the dialog and the filters)
        push({
          id: STALE_TOAST,
          kind: 'error',
          title: errMsg(e),
          desc: 'ระบบไม่บันทึก เพื่อไม่ให้ทับการแก้ไขนั้น — "โหลดใหม่" ดึงข้อมูลล่าสุดของลูกค้ารายนี้มาแทนที่พิมพ์ไว้',
          action: {
            label: 'โหลดใหม่',
            onClick: () =>
              void api<{ rows: Customer[] }>(`/api/customers/lookup${qs({ q: editing.code })}`)
                .then((d) => {
                  const hit = d.rows.find((c) => c.code === editing.code);
                  if (hit) openForm(hit);
                  else push({ kind: 'error', title: 'ไม่พบลูกค้า', desc: `${editing.code} — อาจถูกลบแล้ว` });
                })
                .catch((err) => push({ kind: 'error', title: 'โหลดข้อมูลลูกค้าไม่สำเร็จ', desc: errMsg(err) })),
          },
        });
      } else if (!fe.fromApi(e)) push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  // ลบ = soft delete (record_status DELETED): hidden everywhere, restorable by System Admin — the server checks the
  // same Customer delete right
  const deleteCustomer = async (r: Customer) => {
    const ok = await confirm({
      tone: 'danger',
      title: `ลบลูกค้า ${r.code}?`,
      description: (
        <>
          <span className="font-medium">{r.name}</span> จะถูกซ่อนจากรายการและการค้นหาลูกค้าทุกที่ (ไม่ได้ลบข้อมูลทิ้ง)
          งานและเอกสารเดิมของลูกค้ายังอยู่ครบ
          <br />
          การกู้คืนต้องทำโดยผู้ดูแลระบบ
        </>
      ),
      confirmLabel: 'ลบลูกค้า',
    });
    if (!ok) return;
    try {
      await postJson('/api/admin/records', { table: 'customers', id: r.id, status: 'DELETED' });
      push({ kind: 'success', title: 'ลบลูกค้าแล้ว', desc: `${r.code} · ${r.name}` });
      refetch();
    } catch (e) {
      push({ kind: 'error', title: 'ลบไม่สำเร็จ', desc: errMsg(e) });
    }
  };

  const restoreCustomer = async (r: Customer) => {
    const ok = await confirm({
      title: `กู้คืนลูกค้า ${r.code}?`,
      description: `${r.name} จะกลับมาในรายการและการค้นหาลูกค้าทุกที่อีกครั้ง`,
      confirmLabel: 'กู้คืน',
    });
    if (!ok) return;
    try {
      await postJson('/api/admin/records', { table: 'customers', id: r.id, status: 'ACTIVE' });
      push({ kind: 'success', title: 'กู้คืนลูกค้าแล้ว', desc: `${r.code} · ${r.name}` });
      refetch();
    } catch (e) {
      push({ kind: 'error', title: 'กู้คืนไม่สำเร็จ', desc: errMsg(e) });
    }
  };

  const statusBadge = (r: Customer) =>
    deletedView ? (
      <Badge tone="neutral">ลบแล้ว</Badge>
    ) : (
      <Badge tone={r.status === 'Active' ? 'success' : 'neutral'} dot>
        {r.status}
      </Badge>
    );

  const columns: Column<Customer>[] = [
    {
      key: 'code',
      header: 'รหัสลูกค้า',
      width: '120px',
      hideBelow: 'sm', // phones: name (+ code / phone / status under it) + action
      cell: (r) => <span className="num font-medium">{r.code}</span>,
    },
    {
      key: 'name',
      header: 'ชื่อ-สกุล',
      cell: (r) => (
        // a long company name would keep the column (and the table) wide — cut it, the full name on hover
        <div className="min-w-0 max-w-[180px] sm:max-w-[320px]" title={r.name}>
          <p className="truncate font-medium">{r.name}</p>
          <p className="num truncate text-2xs text-muted-foreground">เลขผู้เสียภาษี {r.taxId || '—'}</p>
          {/* a phone: the code / phone / status columns are hidden — shown here, so the actions fit beside the name */}
          <div className="mt-1 flex flex-wrap items-center gap-1 sm:hidden">
            <span className="num text-2xs">
              {r.code}
              {r.phone && ` · ${r.phone}`}
            </span>
            {statusBadge(r)}
          </div>
        </div>
      ),
    },
    {
      key: 'address',
      header: 'ที่อยู่',
      hideBelow: 'lg',
      cell: (r) => (
        <span className="line-clamp-2 flex max-w-[360px] gap-1.5 text-muted-foreground">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
          {r.address}
        </span>
      ),
    },
    {
      key: 'phone',
      header: 'เบอร์โทรศัพท์',
      width: '140px',
      hideBelow: 'sm',
      cell: (r) => <span className="num">{r.phone}</span>,
    },
    { key: 'email', header: 'Email', hideBelow: 'xl', cell: (r) => <Email value={r.email} /> },
    {
      key: 'status',
      header: 'สถานะ',
      width: '100px',
      hideBelow: 'sm',
      cell: (r) => statusBadge(r),
    },
    {
      key: 'action',
      header: 'จัดการ',
      width: '130px',
      align: 'center',
      sortable: false,
      cell: (r) =>
        deletedView ? (
          <Button variant="outline" size="sm" onClick={() => void restoreCustomer(r)}>
            <RotateCcw className="h-3.5 w-3.5" />
            กู้คืน
          </Button>
        ) : (
          <RowActions
            onView={() => openForm(r, true)}
            onEdit={canEdit ? () => openForm(r) : undefined}
            onHistory={canJobs ? () => router.push(`/jobs/list?customer=${encodeURIComponent(r.code)}`) : undefined}
            onDelete={canDel ? () => void deleteCustomer(r) : undefined}
          />
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="ข้อมูลลูกค้า"
        description="ฐานข้อมูลลูกค้าบุคคลและนิติบุคคล ใช้อ้างอิงตอนเปิดงานและออกเอกสาร"
        actions={
          <>
            {access.isAdmin && (
              <label className="inline-flex items-center gap-2 text-sm">
                <Checkbox checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
                แสดงรายการที่ลบ
              </label>
            )}
            <ExportButton run={() => exportXlsx('customers', { ...filter })} />
            {canAdd && (
              <Button size="sm" onClick={() => openForm(null)}>
                <Plus className="h-3.5 w-3.5" />
                เพิ่มลูกค้า
              </Button>
            )}
          </>
        }
      />

      <FilterBar onSearch={apply} onReset={reset}>
        <Field label="รหัสลูกค้า">
          <Input
            placeholder="C43600"
            className="num"
            value={draft.code}
            onChange={(e) => setD('code', e.target.value)}
          />
        </Field>
        <Field label="ชื่อ-สกุล">
          <Input placeholder="พิมพ์บางส่วนของชื่อ" value={draft.name} onChange={(e) => setD('name', e.target.value)} />
        </Field>
        <Field label="เบอร์โทรศัพท์">
          <Input
            placeholder="08xxxxxxxx"
            className="num"
            inputMode="tel"
            value={draft.phone}
            onChange={(e) => setD('phone', e.target.value)}
          />
        </Field>
        <Field label="Email">
          <Input placeholder="อีเมลบางส่วน" value={draft.email} onChange={(e) => setD('email', e.target.value)} />
        </Field>
        <Field label="เลขบัตรประชาชน / เลขผู้เสียภาษี">
          <Input className="num" value={draft.taxId} onChange={(e) => setD('taxId', e.target.value)} />
        </Field>
        <Field label="ประเภทลูกค้า">
          <Select value={draft.type} onChange={(e) => setD('type', e.target.value)}>
            <option value="">ทั้งหมด</option>
            {CUSTOMER_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="จังหวัด" lookup={provincesLookup}>
          <SearchSelect
            value={draft.province}
            onChange={(v) => setD('province', v)}
            options={PROVINCES.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="ทุกจังหวัด"
            emptyLabel="ทุกจังหวัด"
            searchPlaceholder="พิมพ์ชื่อจังหวัด…"
          />
        </Field>
        <Field label="สถานะ">
          <Select value={draft.status} onChange={(e) => setD('status', e.target.value as CustomerFilter['status'])}>
            <option value="">ทั้งหมด</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </Select>
        </Field>
      </FilterBar>

      <DataTable
        narrowed={narrowed}
        onClearFilters={reset}
        searchable={false}
        columns={columns}
        rows={CUSTOMERS}
        loading={loading}
        error={loadError}
        onRetry={refetch}
        rowKey={(r) => r.code}
        server={{ ...server, total, resetKey: server.resetKey + deletedView }}
      />

      <Modal
        open={open}
        onClose={closeForm}
        title={viewOnly ? 'ข้อมูลลูกค้า' : editing ? 'แก้ไขข้อมูลลูกค้า' : 'เพิ่มลูกค้าใหม่'}
        description={
          viewOnly
            ? `ดูข้อมูล · รหัสลูกค้า ${editing?.code}`
            : editing
              ? `แก้ไขข้อมูล · รหัสลูกค้า ${editing.code}`
              : 'รหัสลูกค้าจะถูกสร้างอัตโนมัติเมื่อบันทึก'
        }
        size="xl"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={closeForm}>
              {viewOnly ? 'ปิด' : 'ยกเลิก'}
            </Button>
            {!viewOnly && (
              <Button size="sm" onClick={save} disabled={saving}>
                บันทึกข้อมูล
              </Button>
            )}
          </>
        }
      >
        <fieldset disabled={viewOnly} className="contents">
          <CustomerFields
            form={form}
            setForm={setForm}
            editing={editing}
            errors={fe.errors}
            clearError={fe.clear}
            extra={
              viewOnly && editing ? (
                <>
                  <Field label="วันที่สร้าง">
                    <Input readOnly value={editing.createdDate || '—'} className="num" />
                  </Field>
                  <Field label="สร้างโดย">
                    <Input readOnly value={editing.createdBy || '—'} />
                  </Field>
                </>
              ) : null
            }
          />
          {conflicts && (
            <div className="mt-4">
              <ConflictNotice
                conflicts={conflicts}
                editing={!!editing}
                pickLabel="เปิดลูกค้ารายนี้"
                onPick={async (code) => {
                  // the clashing customer is often not on this page of the list — look it up by its code
                  const hit =
                    CUSTOMERS.find((c) => c.code === code) ??
                    (
                      await api<{ rows: Customer[] }>(`/api/customers/lookup${qs({ q: code })}`).catch(() => null)
                    )?.rows.find((c) => c.code === code);
                  if (hit) openForm(hit, !canEdit);
                  else push({ kind: 'error', title: 'เปิดข้อมูลลูกค้าไม่ได้', desc: code });
                }}
              />
            </div>
          )}
        </fieldset>
      </Modal>
    </>
  );
}

export default function CustomersPage() {
  return (
    <React.Suspense fallback={null}>
      <CustomersPageInner />
    </React.Suspense>
  );
}
