'use client';

import Link from 'next/link';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAccess } from '@/lib/use-access';

/** "สร้างใบเสนอราคา" for this job — the quotation form pre-fills from ?job=<the job's uuid>; only for roles that may add quotations */
export function QuoteLink({ jobId }: { jobId?: string }) {
  const { canLink } = useAccess();
  const href = '/quotation/new';
  if (!jobId || !canLink({ href, need: 'add' })) return null;
  return (
    <Button asChild variant="outline" size="md">
      <Link href={`${href}?job=${jobId}`}>
        <FileText className="h-4 w-4" />
        สร้างใบเสนอราคา
      </Link>
    </Button>
  );
}
