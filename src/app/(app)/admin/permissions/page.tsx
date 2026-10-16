'use client';

import * as React from 'react';
import { Save, ShieldCheck, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { FilterBar } from '@/components/shared/filter-bar';
import { SearchSelect, strOptions } from '@/components/shared/search-select';
import { Field } from '@/components/ui/field';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { ROLES, type Permission } from '@/data/mock';
import { usePermissions, useRoles } from '@/data/db';
import { postJson } from '@/lib/api';
import {
  ADMIN_USER_TYPE,
  PAGE_MODULES,
  RIGHTS,
  RIGHT_HINTS,
  adminImplicit,
  type Module,
  type Right,
} from '@/lib/modules';

// บทบาท (user_type) มาจากตาราง app_config — ค่า fallback ใช้เฉพาะระหว่างโหลด. เมนูงาน = โมดูลที่มีหน้าในระบบนี้
// (แถวของโมดูลระบบเดิมที่ไม่มีหน้า เช่น Booking ไม่แสดงและไม่ถูกแตะ); สิทธิ์พิเศษ = แถว app_config ชื่อ RIGHTS
// เก็บใน can_view
const MENUS: readonly string[] = PAGE_MODULES;
const RIGHT_NAMES = Object.keys(RIGHTS) as Right[];
const FALLBACK_ROLES = ROLES.filter((r) => r !== 'รออนุมัติ');

type Key = string; // `${role}::${menu}`
const keyOf = (role: string, menu: string): Key => `${role}::${menu}`;

/** the editable grid from the DB rows: role::menu → the four grants */
function buildMap(perms: Permission[]): Record<Key, Cell> {
  const m: Record<Key, Cell> = {};
  for (const p of perms) m[keyOf(p.role, p.menu)] = { add: !!p.add, edit: !!p.edit, del: !!p.del, view: !!p.view };
  return m;
}

type Cell = { add: boolean; edit: boolean; del: boolean; view: boolean };

export default function PermissionsPage() {
  const { push } = useToast();
  const confirm = useConfirm();
  const { data: perms, loading, refetch } = usePermissions();
  const { data: dbRoles } = useRoles();
  const ASSIGNABLE_ROLES = dbRoles.length ? dbRoles : FALLBACK_ROLES;
  const firstRole = ASSIGNABLE_ROLES[0] ?? ROLES[0]; // FALLBACK_ROLES is never empty
  // the editable grant grid, rebuilt from the DB rows whenever they change (loaded / after a save)
  // — adjusted while rendering, not in an effect pass
  const [map, setMap] = React.useState<Record<Key, Cell>>(() => buildMap(perms));
  const [mapFrom, setMapFrom] = React.useState(perms);
  if (perms !== mapFrom) {
    setMapFrom(perms);
    setMap(buildMap(perms));
  }
  // the roles come from the server after the first render: a pick that is not one of them falls back
  // to the first (derived — nothing to align)
  const inRoles = (r: string) => !dbRoles.length || dbRoles.includes(r);
  const [pickedRole, setRole] = React.useState<string>(firstRole);
  const role = inRoles(pickedRole) ? pickedRole : (dbRoles[0] ?? pickedRole); // not in roles ⇒ dbRoles is non-empty
  // filter bar: ประเภทผู้ใช้งาน picks the role being edited (at once — the table never shows another
  // role than the one picked); เมนูงาน narrows the rows shown (on ค้นหา) — edits live in `map` for
  // every menu, so hidden rows are still saved
  const [menuFilter, setMenuFilter] = React.useState('');
  const [draftPick, setDraft] = React.useState({ role: firstRole, menu: '' });
  const draft = inRoles(draftPick.role) ? draftPick : { ...draftPick, role: dbRoles[0] ?? draftPick.role };
  const [saving, setSaving] = React.useState(false);

  const cellOf = (r: string, menu: string): Cell =>
    map[keyOf(r, menu)] ?? { add: false, edit: false, del: false, view: false };
  // System Admin holds every module and right without a row (checkGrant / checkRight) — shown ticked and
  // locked, whatever its rows say (they are saved back as stored); Job Take stays a real tick
  const implicit = (menu: string) => role === ADMIN_USER_TYPE && adminImplicit(menu as Module);

  // ticked but not saved: switching role used to drop these edits without a word
  const FIELDS = ['add', 'edit', 'del', 'view'] as const;
  const savedMap = React.useMemo(() => buildMap(perms), [perms]);
  const dirty = [...MENUS, ...RIGHT_NAMES].some((menu) => {
    const saved = savedMap[keyOf(role, menu)];
    const now = cellOf(role, menu);
    return FIELDS.some((f) => now[f] !== !!saved?.[f]);
  });
  useUnsavedChanges(dirty); // a sidebar link / closing the tab asks first, as on every form
  const pickRole = async (v: string) => {
    if (v !== role && dirty) {
      const ok = await confirm({
        tone: 'danger',
        title: 'มีการแก้ไขที่ยังไม่บันทึก — ทิ้งการแก้ไข?',
        description: `สิทธิ์ของ ${role} ที่ติ๊กไว้ยังไม่ได้บันทึก ถ้าเปลี่ยนบทบาทตอนนี้ การแก้ไขจะหายไป`,
        confirmLabel: 'ทิ้งการแก้ไข',
        cancelLabel: 'อยู่ต่อ',
      });
      if (!ok) return setDraft((d) => ({ ...d, role })); // the dropdown goes back to the role being edited
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

  // rows for the selected role — every menu (so anything can be granted), narrowed by the เมนูงาน filter
  const viewRows: Permission[] = MENUS.filter((menu) => !menuFilter || menu === menuFilter).map((menu) => {
    const c = cellOf(role, menu);
    return { id: keyOf(role, menu), role, menu, ...c };
  });

  const save = async () => {
    setSaving(true);
    try {
      const items = [...MENUS, ...RIGHT_NAMES].map((menu) => ({ role, menu, ...cellOf(role, menu) }));
      await postJson('/api/admin/permissions', { items }); // 401 → refresh + retry → /login (api.ts)
      // the API checks the new grants on the very next request (cache dropped on save); menus and
      // buttons of someone already signed in follow on their next page load (the grants ride the layout)
      push({
        kind: 'success',
        title: `บันทึกสิทธิ์บทบาท ${role} แล้ว`,
        desc: 'มีผลทันทีกับการบันทึกข้อมูล — ผู้ใช้ที่เปิดระบบค้างไว้จะเห็นเมนูและปุ่มตามสิทธิ์ใหม่เมื่อรีเฟรชหน้า (F5)',
      });
      refetch();
    } catch (e) {
      push({
        kind: 'error',
        title: 'บันทึกไม่สำเร็จ',
        desc: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const check = (field: keyof Cell, header: string): Column<Permission> => ({
    key: field,
    header,
    align: 'center',
    width: '130px',
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
      cell: (_r, i) => <span className="num text-muted-foreground">{i + 1}</span>,
    },
    {
      key: 'menu',
      header: 'เมนูงาน',
      cell: (r) => <span className="font-medium">{r.menu}</span>,
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
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            บันทึกสิทธิ์
          </Button>
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
          <SearchSelect value={draft.role} onChange={(v) => void pickRole(v)} options={strOptions(ASSIGNABLE_ROLES)} />
        </Field>
        <Field label="เมนูงาน">
          <SearchSelect
            placeholder="ทั้งหมด"
            emptyLabel="ทั้งหมด"
            value={draft.menu}
            onChange={(v) => setDraft((d) => ({ ...d, menu: v }))}
            options={strOptions(MENUS)}
          />
        </Field>
      </FilterBar>

      <DataTable
        searchable={false}
        columns={columns}
        rows={viewRows}
        loading={loading}
        rowKey={(r) => r.id}
        pageSize={25}
        dense
        toolbar={
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
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
              </label>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
