import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown by the App Router while the (app) layout resolves the session on a
 * navigation — a generic page outline (header, KPI row, table) so the shell
 * does not sit empty and the content does not jump in.
 */
export default function AppLoading() {
  return (
    <div className="space-y-5" aria-busy aria-label="กำลังโหลด">
      <div className="space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-3.5 w-80 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="surface flex items-center gap-3 p-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-12" />
            </div>
          </div>
        ))}
      </div>
      <div className="surface overflow-hidden">
        <div className="border-b border-border px-3 py-2.5">
          <Skeleton className="h-8 w-full sm:w-72" />
        </div>
        <div className="divide-y divide-border/70">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-3 py-3">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className={i % 2 ? "h-3.5 w-1/3" : "h-3.5 w-1/2"} />
              <Skeleton className="ml-auto h-3.5 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
