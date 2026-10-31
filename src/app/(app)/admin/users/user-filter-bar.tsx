'use client';

import { FilterBar } from '@/components/shared/filter-bar';
import { SearchSelect, strOptions } from '@/components/shared/search-select';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';

export type UserFilter = { name: string; username: string; role: string; status: '' | 'Active' | 'Inactive' };

export function UserFilterBar({
  draft,
  setD,
  onSearch,
  onReset,
  roleOptions,
}: {
  draft: UserFilter;
  setD: <K extends keyof UserFilter>(k: K, v: UserFilter[K]) => void;
  onSearch: () => void;
  onReset: () => void;
  roleOptions: string[];
}) {
  return (
    <FilterBar onSearch={onSearch} onReset={onReset}>
      <Field label="ชื่อ-สกุล ผู้ใช้ระบบ">
        <Input placeholder="พิมพ์บางส่วนของชื่อ" value={draft.name} onChange={(e) => setD('name', e.target.value)} />
      </Field>
      <Field label="Username">
        <Input
          placeholder="username"
          className="num"
          value={draft.username}
          onChange={(e) => setD('username', e.target.value)}
        />
      </Field>
      <Field label="ประเภทผู้ใช้งาน">
        <SearchSelect
          placeholder="ทั้งหมด"
          emptyLabel="ทั้งหมด"
          value={draft.role}
          onChange={(v) => setD('role', v)}
          options={strOptions(roleOptions)}
        />
      </Field>
      <Field label="สถานะ">
        <Select value={draft.status} onChange={(e) => setD('status', e.target.value as UserFilter['status'])}>
          <option value="">ทั้งหมด</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </Select>
      </Field>
    </FilterBar>
  );
}
