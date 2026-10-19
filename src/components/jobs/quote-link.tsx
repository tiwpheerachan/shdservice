'use client';

import Link from 'next/link';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAccess } from '@/lib/use-access';

/** "สร้างใบเสนอราคา" for this job — the quotation form pre-fills from ?job=; only for roles that may add quotations */
export function QuoteLink({ jobNo }: { jobNo?: string }) {
  const { canLink } = useAccess();
  const href = '/quotation/new';
  if (!jobNo || !canLink({ href, need: 'add' })) return null;
  return (
    <Button asChild variant="outline" size="md">
      <Link href={`${href}?job=${encodeURIComponent(jobNo)}`}>
        <FileText className="h-4 w-4" />
        สร้างใบเสนอราคา
      </Link>
    </Button>
  );
}
