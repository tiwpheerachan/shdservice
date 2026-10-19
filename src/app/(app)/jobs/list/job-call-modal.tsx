'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import type { Job, Customer } from '@/data/types';
import { api, qs } from '@/lib/api';

// call-log modal — loaded on first open, not with the list page
const CustomerCallModal = dynamic(
  () => import('@/components/shared/customer-call-modal').then((m) => m.CustomerCallModal),
  { ssr: false },
);

/** the customer / call-log modal behind a row's phone button: `openCall(job)`, render `modal` */
export function useJobCallModal() {
  const [callFor, setCallFor] = React.useState<{
    customer: Customer | null;
    jobNo: string;
  } | null>(null);
  // mount the (lazy) modal on first open and keep it mounted so the close animation still plays
  const [modalUsed, setModalUsed] = React.useState(false);
  if (callFor && !modalUsed) setModalUsed(true); // adjusted while rendering (first open)

  // customer_detail = "C12150 ชื่อ เบอร์" → look the customer up by code
  const openCall = async (job: Job) => {
    const code = job.customer.split(/\s+/)[0] ?? '';
    let customer: Customer | null = null;
    try {
      const d = await api<{ rows: Customer[] }>(`/api/customers/lookup${qs({ q: code })}`);
      customer = d.rows[0] ?? null;
    } catch {
      customer = null;
    }
    setCallFor({ customer, jobNo: job.no });
  };

  const modal = modalUsed && (
    <CustomerCallModal
      open={!!callFor}
      onClose={() => setCallFor(null)}
      customer={callFor?.customer ?? null}
      jobNo={callFor?.jobNo}
    />
  );
  return { openCall, modal };
}
