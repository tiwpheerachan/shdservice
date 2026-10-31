'use client';

import * as React from 'react';
import { Save, ShieldCheck, Loader2, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { FilterBar } from '@/components/shared/filter-bar';
import { SearchSelect, strOptions } from '@/components/shared/search-select';
import { Field } from '@/components/ui/field';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox, Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { ROLES } from '@/data/options';
import type { Permission } from '@/data/types';
import { usePermissions, useRoles } from '@/data/db';
import { del, errMsg, isStale, postJson } from '@/lib/api';
import {
  ADMIN_USER_TYPE,
  MODULE_LABELS,
  PAGE_MODULES,
  RIGHTS,
  RIGHT_HINTS,
  adminImplicit,
  type Module,
  type Right,
} from '@/lib/modules';
import { PENDING_ROLE } from '@/lib/access';
import { masterNameKey } from '@/lib/validation/admin';
import { useTourRestore } from '@/components/tour/tour';

// เมนูงาน = โมดูลที่มีหน้าในระบบนี้: แถวของโมดูลระบบเดิมที่ไม่มีหน้า (เช่น Booking) ไม่แสดงและไม่ถูกแตะ; สิทธิ์พิเศษ = แถว role_permission ชื่อ RIGHTS (เก็บใน can_view)
const MENUS: readonly string[] = PAGE_MODULES;
const RIGHT_NAMES = Object.keys(RIGHTS) as Right[];
const FALLBACK_ROLES = ROLES.filter((r) => r !== PENDING_ROLE);

type Key = string; // `${role}::${menu}`
const keyOf = (role: string, menu: string): Key => `${role}::${menu}`;

function buildMap(perms: Permission[]): Record<Key, Cell> {
  const m: Record<Key, Cell> = {};
  for (const p of perms) m[keyOf(p.role, p.menu)] = { add: !!p.add, edit: !!p.edit, del: !!p.del, view: !!p.view };
  return m;
}

type Cell = { add: boolean; edit: boolean; del: boolean; view: boolean };
const OFF: Cell = { add: false, edit: false, del: false, view: false };

export default function PermissionsPage() {
  const { push } = useToast();
  const confirm = useConfirm();
  const { data: perms, loading, refetch } = usePermissions();
  const { data: dbRoles, refetch: refetchRoles } = useRoles();
  // เพิ่มตำแหน่ง: a new role lives here (an empty grid) until its first ticks are saved — then it is in role_permission
  const [newRoles, setNewRoles] = React.useState<string[]>([]);
  const ASSIGNABLE_ROLES = dbRoles.length
    ? [...dbRoles, ...newRoles.filter((r) => !dbRoles.includes(r))]
    : FALLBACK_ROLES;
  const firstRole = ASSIGNABLE_ROLES[0] ?? ROLES[0]; // FALLBACK_ROLES is never empty
  const [map, setMap] = React.useState<Record<Key, Cell>>(() => buildMap(perms));
  const [mapFrom, setMapFrom] = React.useState(perms);
  if (perms !== mapFrom) {
    setMapFrom(perms);
    setMap(buildMap(perms));
  }
  // roles arrive after the first render: a pick not among them falls back to the first
  const inRoles = (r: string) => !dbRoles.length || ASSIGNABLE_ROLES.includes(r);
  const [pickedRole, setRole] = React.useState<string>(firstRole);
  const role = inRoles(pickedRole) ? pickedRole : (dbRoles[0] ?? pickedRole); // not in roles ⇒ dbRoles is non-empty
  // edits live in `map` for every menu, so rows hidden by the เมนูงาน filter are still saved
  const [menuFilter, setMenuFilter] = React.useState('');
  const [draftPick, setDraft] = React.useState({ role: firstRole, menu: '' });
  const draft = inRoles(draftPick.role) ? draftPick : { ...draftPick, role: dbRoles[0] ?? draftPick.role };
  const [saving, setSaving] = React.useState(false);

  const cellOf = (r: string, menu: string): Cell =>
    map[keyOf(r, menu)] ?? { add: false, edit: false, del: false, view: false };
  // System Admin holds every module and right without a row (checkGrant / checkRight) — shown ticked and
  // locked, whatever its rows say (they are saved back as stored); Job Take stays a real tick
  const implicit = (menu: string) => role === ADMIN_USER_TYPE && adminImplicit(menu as Module);

  // ticked but not saved: switching role asks before dropping these edits
  const FIELDS = ['add', 'edit', 'del', 'view'] as const;
  const savedMap = React.useMemo(() => buildMap(perms), [perms]);
  const dirty = [...MENUS, ...RIGHT_NAMES].some((menu) => {
    const saved = savedMap[keyOf(role, menu)];
    const now = cellOf(role, menu);
    return FIELDS.some((f) => now[f] !== !!saved?.[f]);
  });
  useUnsavedChanges(dirty);
  const pickRole = async (v: string) => {
    if (v !== role && dirty) {
      const ok = await confirm({
        tone: 'danger',
        title: 'มีการแก้ไขที่ยังไม่บันทึก — ทิ้งการแก้ไข?',
        description: `สิทธิ์ของ ${role} ที่ติ๊กไว้ยังไม่ได้บันทึก ถ้าเปลี่ยนบทบาทตอนนี้ การแก้ไขจะหายไป`,
        confirmLabel: 'ทิ้งการแก้ไข',
        cancelLabel: 'อยู่ต่อ',
      });
      if (!ok) return setDraft((d) => ({ ...d, role }));
      setMap(savedMap);
    }
    setDraft((d) => ({ ...d, role: v }));
    setRole(v);
  };

  const toggle = (menu: string, field: keyof Cell) =>
    setMap((s) => {
      const k = keyOf(role, menu);
      const cur = s[k] ?? { add: false, edit: false, del: false, view: false };
      return { ...s, [k]: { ...cur, [field]: !cur[field] } };
    });

  const viewRows: Permission[] = MENUS.filter((menu) => !menuFilter || menu === menuFilter).map((menu) => {
    const c = cellOf(role, menu);
    return { id: keyOf(role, menu), role, menu, ...c };
  });

  const save = async () => {
    // only the rows this admin changed, each with the row as loaded: the server sets them compare-and-set, so
    // another admin's ticks on this role are never overwritten (a row both changed → 409, the grid reloads)
    const items = [...MENUS, ...RIGHT_NAMES].flatMap((menu) => {
      const was = savedMap[keyOf(role, menu)] ?? OFF;
      const now = cellOf(role, menu);
      return FIELDS.some((f) => now[f] !== was[f]) ? [{ role, menu, ...now, was }] : [];
    });
    if (!items.length) {
      push({ kind: 'warning', title: 'ยังไม่มีการเปลี่ยนแปลง', desc: `สิทธิ์ของ ${role} ตรงกับที่บันทึกไว้` });
      return;
    }
    setSaving(true);
    try {
      await postJson('/api/admin/permissions', { items });
      // the API checks the new grants on the very next request (cache dropped on save); menus and
      // buttons of someone already signed in follow on their next page load (the grants ride the layout)
      push({
        kind: 'success',
        title: `บันทึกสิทธิ์บทบาท ${role} แล้ว`,
        desc: 'มีผลทันทีกับการบันทึกข้อมูล — ผู้ใช้ที่เปิดระบบค้างไว้จะเห็นเมนูและปุ่มตามสิทธิ์ใหม่เมื่อรีเฟรชหน้า (F5)',
      });
      refetch();
      refetchRoles();
    } catch (e) {
      if (isStale(e)) refetch();
      push({
        kind: 'error',
        title: 'บันทึกไม่สำเร็จ',
        desc: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const [adding, setAdding] = React.useState<string | null>(null);
  const addName = adding?.trim() ?? '';
  // tour restore: only the typed name — the tour opens and closes the dialog itself
  useTourRestore(
    () => ({ adding: adding || null, newRoles, pickedRole, draftPick }),
    (v) => {
      setAdding(v.adding);
      setNewRoles(v.newRoles);
      setRole(v.pickedRole);
      setDraft(v.draftPick);
    },
  );
  const addError =
    addName.length > 50
      ? 'ชื่อตำแหน่งยาวเกิน 50 ตัวอักษร'
      : [...ASSIGNABLE_ROLES, PENDING_ROLE].some((r) => masterNameKey(r) === masterNameKey(addName)) // case / spaces ignored, as the API
        ? 'มีตำแหน่งนี้อยู่แล้ว'
        : '';
  const addRole = async () => {
    if (!addName || addError) return;
    setAdding(null);
    setNewRoles((r) => [...r, addName]);
    await pickRole(addName);
  };
  // ลบตำแหน่ง: refused by the server while a user has the role
  const removeRole = async () => {
    const ok = await confirm({
      tone: 'danger',
      title: `ลบตำแหน่ง ${role}?`,
      description: 'สิทธิ์ทั้งหมดของตำแหน่งนี้จะถูกลบ — ทำได้เมื่อไม่มีผู้ใช้อยู่ในตำแหน่งนี้แล้วเท่านั้น',
      confirmLabel: 'ลบตำแหน่ง',
    });
    if (!ok) return;
    try {
      if (dbRoles.includes(role)) await del(`/api/admin/permissions?role=${encodeURIComponent(role)}`);
      setNewRoles((r) => r.filter((x) => x !== role));
      push({ kind: 'success', title: `ลบตำแหน่ง ${role} แล้ว` });
      setMap(savedMap);
      setDraft((d) => ({ ...d, role: firstRole }));
      setRole(firstRole);
      refetch();
      refetchRoles();
    } catch (e) {
      push({ kind: 'error', title: 'ลบตำแหน่งไม่สำเร็จ', desc: errMsg(e) });
    }
  };

  const check = (field: keyof Cell, header: string): Column<Permission> => ({
    key: field,
    header,
    align: 'center',
    width: '64px',
    sortable: false,
    cell: (r) => (
      <Checkbox
        checked={implicit(r.menu) || !!r[field]}
        disabled={implicit(r.menu)}
        onChange={() => toggle(r.menu, field)}
        aria-label={`${header} · ${r.menu}`}
      />
    ),
  });

  const columns: Column<Permission>[] = [
    {
      key: 'no',
      header: '#',
      width: '52px',
      align: 'center',
      sortable: false,
      hideBelow: 'sm',
      cell: (_r, i) => <span className="num text-muted-foreground">{i + 1}</span>,
    },
    {
      key: 'menu',
      header: 'เมนูงาน',
      // the menu as the sidebar names it; the role_permission key under it (what the old system / the data say)
      cell: (r) => (
        <span>
          <span className="block font-medium">{MODULE_LABELS[r.menu as keyof typeof MODULE_LABELS] ?? r.menu}</span>
          <span className="block text-2xs text-muted-foreground">{r.menu}</span>
        </span>
      ),
    },
    check('add', 'เพิ่ม'),
    check('edit', 'แก้ไข'),
    check('del', 'ลบ'),
    check('view', 'ดู'),
  ];

  return (
    <>
      <PageHeader
        title="สิทธิการใช้งาน"
        description="กำหนดสิทธิ์เพิ่ม / แก้ไข / ลบ / ดูข้อมูล แยกตามบทบาทและเมนูงาน และสิทธิ์พิเศษของแต่ละบทบาท"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setAdding('')}>
              <Plus className="h-3.5 w-3.5" />
              เพิ่มตำแหน่ง
            </Button>
            <Button variant="outline" size="sm" onClick={removeRole} disabled={role === ADMIN_USER_TYPE}>
              <Trash2 className="h-3.5 w-3.5" />
              ลบตำแหน่ง
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              บันทึกสิทธิ์
            </Button>
          </>
        }
      />

      <FilterBar
        onSearch={() => {
          void pickRole(draft.role);
          setMenuFilter(draft.menu);
        }}
        onReset={() => {
          setDraft((d) => ({ ...d, menu: '' }));
          setMenuFilter('');
          void pickRole(firstRole);
        }}
      >
        <Field label="ประเภทผู้ใช้งาน" required>
          <SearchSelect
            placeholder="- - เลือกบทบาท - -"
            value={draft.role}
            onChange={(v) => void pickRole(v)}
            options={strOptions(ASSIGNABLE_ROLES)}
          />
        </Field>
        <Field label="เมนูงาน">
          <SearchSelect
            placeholder="ทั้งหมด"
            emptyLabel="ทั้งหมด"
            value={draft.menu}
            onChange={(v) => setDraft((d) => ({ ...d, menu: v }))}
            options={MENUS.map((m) => ({
              value: m,
              label: MODULE_LABELS[m as keyof typeof MODULE_LABELS] ?? m,
              sub: m,
            }))}
          />
        </Field>
      </FilterBar>

      <DataTable
        searchable={false}
        columns={columns}
        rows={viewRows}
        loading={loading}
        rowKey={(r) => keyOf(r.role, r.menu)}
        pageSize={25}
        dense
        toolbar={
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            กำลังกำหนดสิทธิ์ของ <Badge tone="primary">{role}</Badge>
            <span className="num">
              {viewRows.length} / {MENUS.length} เมนู
            </span>
            {role === ADMIN_USER_TYPE && <span>· System Admin ใช้ได้ทุกเมนูเสมอ (ไม่ต้องติ๊ก)</span>}
          </span>
        }
      />

      <section className="surface flex flex-col gap-3 p-4" aria-labelledby="special-rights">
        <div>
          <h2 id="special-rights" className="text-sm font-semibold">
            สิทธิ์พิเศษ
          </h2>
          <p className="text-xs text-muted-foreground">
            เรื่องที่ไม่ได้ผูกกับเมนูใดเมนูหนึ่ง — ติ๊ก = บทบาท {role} ทำได้ · System Admin มีทุกข้อเสมอ ยกเว้น
            {RIGHTS['Job Take']} (ติ๊กเมื่อให้ System Admin มีชื่อในช่องมอบหมายงาน) · บันทึกพร้อมตารางด้านบน
          </p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {RIGHT_NAMES.map((r, i) => (
            <li key={r} className="flex items-start gap-2">
              <Checkbox
                id={`right-${i}`}
                className="mt-0.5"
                checked={implicit(r) || cellOf(role, r).view}
                disabled={implicit(r)}
                onChange={() => toggle(r, 'view')}
              />
              <label htmlFor={`right-${i}`} className="cursor-pointer text-sm">
                {RIGHTS[r]} <span className="text-xs text-muted-foreground">({r})</span>
                <span className="block text-xs text-muted-foreground">{RIGHT_HINTS[r]}</span>
                {r === 'Report' && (
                  <span className="block text-xs text-warning">
                    ติ๊กข้อนี้อย่างเดียวเห็นแค่ตัวเลขสรุป — ตารางและปุ่ม Excel ของแต่ละรายงานต้องมีสิทธิ์ ดู
                    ของเมนูนั้นด้วย (รายงานงานซ่อม: เมนูงานซ่อม · เสนอราคา: Quotation · ขาย: Sale Order · อะไหล่คงเหลือ:
                    Product)
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
      </section>

      <Modal
        open={adding !== null}
        onClose={() => setAdding(null)}
        title="เพิ่มตำแหน่ง"
        description="ตำแหน่งใหม่เริ่มจากไม่มีสิทธิ์ใดเลย — ติ๊กสิทธิ์แล้วกด บันทึกสิทธิ์ ตำแหน่งจึงถูกบันทึก"
        size="sm"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setAdding(null)}>
              ยกเลิก
            </Button>
            <Button size="sm" onClick={addRole} disabled={!addName || !!addError}>
              เพิ่มตำแหน่ง
            </Button>
          </>
        }
      >
        <Field label="ชื่อตำแหน่ง" required error={addError || undefined}>
          <Input
            value={adding ?? ''}
            maxLength={50}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void addRole()}
            autoFocus
          />
        </Field>
      </Modal>
    </>
  );
}
