'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { SaleOrderForm, type SaleOrderFormHandle } from '@/components/shared/sale-order-form';
import { FormActions, VIEW_ONLY } from '@/components/shared/job-form';
import { useToast } from '@/components/ui/toast';
import { postJson, errMsg } from '@/lib/api';
import { useAccess } from '@/lib/use-access';

export default function NewSaleOrderPage() {
  const { push } = useToast();
  const { can } = useAccess();
  const router = useRouter();
  const form = React.useRef<SaleOrderFormHandle>(null);
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    const p = form.current?.payload();
    if (!p || !form.current?.validate()) return;
    setSaving(true);
    try {
      const d = await postJson<{ order: { id: string; no: string } }>('/api/sale-orders', p);
      await form.current?.uploadPendingSlip(d.order.id);
      push({ kind: 'success', title: 'สร้างใบสั่งขายแล้ว', desc: d.order.no });
      router.push(`/sale/orders/edit?id=${d.order.id}`);
    } catch (e) {
      if (!form.current?.fromApi(e)) push({ kind: 'error', title: 'บันทึกไม่สำเร็จ', desc: errMsg(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader title="สร้างใบสั่งขาย" description="เมนูขาย » ใบสั่งขาย" />
      <SaleOrderForm ref={form} />
      <FormActions
        cancelLabel="กลับ"
        saveLabel="บันทึกใบสั่งขาย"
        onSave={save}
        saving={saving}
        cancelHref="/sale/orders"
        denied={can('Sale Order', 'add') ? undefined : VIEW_ONLY}
      />
    </>
  );
}
