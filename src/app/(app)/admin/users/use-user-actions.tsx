'use client';

import * as React from 'react';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import type { User } from '@/data/types';
import { postJson } from '@/lib/api';
import { postUser, toForm, type UserForm } from './user-dialog';

/** the row buttons: อนุมัติ / ถอนสิทธิ์ / คืนสิทธิ์ (quickSet) and ลบ / กู้คืน (softSet); `busyId` = the row in flight */
export function useUserActions(refetch: () => void) {
  const { push } = useToast();
  const confirm = useConfirm();

  // Quick inline actions (revoke / restore) — write straight to the DB and refetch.
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const quickSet = async (r: User, patch: Partial<UserForm>, okTitle: string) => {
    setBusyId(r.id);
    try {
      await postUser({ ...toForm(r), ...patch });
      push({ kind: 'success', title: okTitle, desc: r.name });
      refetch();
      return true;
    } catch (e) {
      push({
        kind: 'error',
        title: 'ทำรายการไม่สำเร็จ',
        desc: e instanceof Error ? e.message : String(e),
      });
      return false;
    } finally {
      setBusyId(null);
    }
  };

  // ถอนสิทธิ์ / คืนสิทธิ์ — one click used to act at once; ask first, naming the person
  const setActive = async (r: User, active: boolean) => {
    const ok = await confirm({
      tone: active ? 'default' : 'danger',
      title: active ? `คืนสิทธิ์ ${r.name}?` : `ถอนสิทธิ์ ${r.name}?`,
      description: active
        ? `${r.name} (${r.role}) จะกลับมาเข้าระบบได้ตามสิทธิ์ของบทบาทนี้`
        : `${r.name} (${r.role}) จะเข้าระบบไม่ได้จนกว่าจะคืนสิทธิ์ — ข้อมูลและงานเก่ายังอยู่ครบ`,
      confirmLabel: active ? 'คืนสิทธิ์' : 'ถอนสิทธิ์',
    });
    if (ok) await quickSet(r, { status: active ? 'Active' : 'Inactive' }, active ? 'คืนสิทธิ์แล้ว' : 'ถอนสิทธิ์แล้ว');
  };

  // Soft delete / restore via the generic records endpoint (401-resilient).
  const softSet = async (r: User, deleted: boolean) => {
    if (deleted) {
      const ok = await confirm({
        tone: 'danger',
        title: `ลบผู้ใช้ ${r.name}?`,
        description: (
          <>
            {r.name} ({r.role}) จะเข้าระบบไม่ได้และหายจากรายชื่อพนักงานในทุกฟอร์ม งานเก่าที่เคยทำยังแสดงชื่อได้ตามเดิม
            <br />
            กู้คืนได้จากแท็บ "รายการที่ลบ" — ถ้าแค่พักการใช้งาน ให้กด ถอนสิทธิ์ แทน
          </>
        ),
        confirmLabel: 'ลบผู้ใช้',
      });
      if (!ok) return;
    } else {
      // the server restores INACTIVE (a revoked account must not come back open by itself) — say so first
      const ok = await confirm({
        title: `กู้คืนผู้ใช้ ${r.name}?`,
        description: `${r.name} จะกลับมาอยู่ในรายชื่อแบบ Inactive — ยังเข้าระบบไม่ได้ ถ้าจะให้ใช้งานต่อ กด คืนสิทธิ์ ที่แถวนั้นอีกครั้ง`,
        confirmLabel: 'กู้คืน',
      });
      if (!ok) return;
    }
    setBusyId(r.id);
    try {
      await postJson('/api/admin/records', { table: 'users', id: r.id, deleted });
      push({
        kind: 'success',
        title: deleted ? 'ย้ายไปรายการที่ลบแล้ว' : 'กู้คืนแล้ว (ยังปิดการใช้งาน)',
        desc: r.name,
      });
      refetch();
    } catch (e) {
      push({
        kind: 'error',
        title: 'ทำรายการไม่สำเร็จ',
        desc: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusyId(null);
    }
  };

  return { busyId, quickSet, setActive, softSet };
}
