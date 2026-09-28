import { QuotationDoc } from "@/components/print/docs/quotation";

export const dynamic = "force-dynamic";

/** staff print view (login required by app/print/layout.tsx) — the customer gets the same sheet via /track/doc */
export default async function Page({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  return <QuotationDoc no={decodeURIComponent(no).toUpperCase()} />;
}
