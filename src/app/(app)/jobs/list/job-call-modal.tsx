'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import type { Job, Customer } from '@/data/types';
import { api, qs } from '@/lib/api';

const CustomerCallModal = dynamic(
  () => import('@/components/shared/customer-call-modal').then((m) => m.CustomerCallModal),
  { ssr: false },
);

/** the customer / call-log modal behind a row's phone button: `openCall(job)`, render `modal` */
export function useJobCallModal() {
  const [callFor, setCallFor] = React.useState<{
    customer: Customer | null;
    job: { id: string; no: string };
  } | null>(null);
  // mount the (lazy) modal on first open and keep it mounted so the close animation still plays
  const [modalUsed, setModalUsed] = React.useState(false);
  if (callFor && !modalUsed) setModalUsed(true);

  // the job's customer by its uuid (job.customer is display text: a legacy snapshot "code name phone")
  const openCall = async (job: Job) => {
    let customer: Customer | null = null;
    try {
      if (job.customerId)
        customer =
          (await api<{ rows: Customer[] }>(`/api/customers/lookup${qs({ q: job.customerId })}`)).rows[0] ?? null;
    } catch {
      customer = null;
    }
    setCallFor({ customer, job: { id: job.id, no: job.no } });
  };

  const modal = modalUsed && (
    <CustomerCallModal
      open={!!callFor}
      onClose={() => setCallFor(null)}
      customer={callFor?.customer ?? null}
      job={callFor?.job}
    />
  );
  return { openCall, modal };
}
