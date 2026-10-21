'use client';

import { Loader2 } from 'lucide-react';
import { SearchSelect, strOptions } from '@/components/shared/search-select';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Field } from '@/components/ui/field';
import type { User } from '@/data/types';
import { PENDING_ROLE } from '@/lib/access';

/** อนุมัติ asks for the role first, nothing pre-picked */
export function ApproveDialog({
  approving,
  role,
  onRoleChange,
  onClose,
  onConfirm,
  busyId,
  roleOptions,
}: {
  approving: User | null;
  role: string;
  onRoleChange: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  busyId: string | null;
  roleOptions: string[];
}) {
  return (
    <Modal
      open={!!approving}
      onClose={onClose}
      title={`อนุมัติ ${approving?.name ?? ''}`}
      description="เลือกบทบาทที่จะใช้ — สิทธิ์เมนูทั้งหมดมาจากบทบาทนี้"
      size="sm"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busyId === approving?.id}>
            ยกเลิก
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={!role || busyId === approving?.id}>
            {busyId === approving?.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            อนุมัติ
          </Button>
        </>
      }
    >
      <Field label="ประเภทผู้ใช้งาน / สิทธิ์" required>
        <SearchSelect
          placeholder="- - เลือกบทบาท - -"
          value={role}
          onChange={onRoleChange}
          options={strOptions(roleOptions.filter((x) => x !== PENDING_ROLE))}
        />
      </Field>
    </Modal>
  );
}
