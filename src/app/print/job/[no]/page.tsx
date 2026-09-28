import { JobReceiptDoc } from "@/components/print/docs/job-receipt";

export const dynamic = "force-dynamic";

/** staff print view (login required by app/print/layout.tsx) — the customer gets the same sheet via /track/doc */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  return <JobReceiptDoc no={decodeURIComponent(no).toUpperCase()} />;
}
