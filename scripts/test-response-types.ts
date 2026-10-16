/**
 * The response schemas of src/server/contract against the types the services are written in — checked by
 * `npx tsc --noEmit` (npm run typecheck), which reads this file like any other: a field added to, removed
 * from or retyped on either side and not the other fails the typecheck. Nothing runs.
 *
 * The schema is the wire shape the document promises (z.input: the JSON as sent); Wire<T> is what a
 * service's type becomes once JSON.stringify has turned its Dates into strings. What the routes really
 * send is held to the same schemas at run time (src/server/contract/check.ts, strict in npm run test:db).
 */
import type { z } from 'zod';
import type * as Mock from '@/data/mock';
import type { PublicJob as PublicJobType, PublicJobSummary as PublicJobSummaryType } from '@/lib/track-public';
import type { AuditRow as AuditRowType } from '@/server/audit';
import type { Page } from '@/server/paging';
import type { OverdueAlerts, PendingSaleOrders } from '@/server/services/alerts';
import type { DocumentProfile as DocumentProfileType } from '@/server/services/document-profiles';
import type { JobDetail as JobDetailType, JobListRow, listCallLogs } from '@/server/services/jobs';
import type { QuotationDetail as QuotationDetailType } from '@/server/services/quotations';
import type { SaleOrderDetail as SaleOrderDetailType } from '@/server/services/sale-orders';
import type { ShippingProfile as ShippingProfileType } from '@/server/services/shipping-profiles';
import type {
  PartRequestLine as PartRequestLineType,
  ReturnLine,
  SoPickLine,
  listIssuedLines,
  movementLines,
  productStockCard,
} from '@/server/services/stock';
import type { LinkStatus as LinkStatusType } from '@/server/services/tracking';
import type { page } from '@/server/contract/common';
import type { CallLog } from '@/server/contract/jobs';
import type { OverdueAlertsBody, PendingSaleOrdersBody } from '@/server/contract/sales';
import type { MovementLine, ReturnableLine, SaleOrderPickLine, StockCardLine } from '@/server/contract/stock';
import type {
  AuditRow,
  Customer,
  DocumentProfile,
  IssuedLine,
  Job,
  JobDetail,
  LinkStatus,
  MasterRow,
  Model,
  Movement,
  PartRequestLine,
  Permission,
  Product,
  PublicJob,
  PublicJobSummary,
  Quotation,
  QuotationDetail,
  SaleOrder,
  SaleOrderDetail,
  ShippingProfile,
  Symptom,
  SystemUser,
} from '@/server/contract/shapes';

/** JSON.stringify's view of a type: Dates become strings; `A & B` flattened into one object type */
type Wire<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;
/** exactly the same type (not merely assignable either way) */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type Same<S extends z.ZodType, T> = Equal<Wire<z.input<S>>, Wire<T>>;
type Row<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>> extends (infer R)[] ? R : never;

export type Checks = [
  // records shared by several operations (shapes.ts)
  Expect<Same<typeof Customer, Mock.Customer>>,
  Expect<Same<typeof AuditRow, AuditRowType>>,
  Expect<Same<typeof PartRequestLine, PartRequestLineType>>,
  Expect<Same<typeof JobDetail, JobDetailType>>,
  Expect<Same<typeof Job, JobListRow>>,
  Expect<Same<typeof Quotation, Mock.Quotation>>,
  Expect<Same<typeof QuotationDetail, QuotationDetailType>>,
  Expect<Same<typeof SaleOrder, Mock.SaleOrder>>,
  Expect<Same<typeof SaleOrderDetail, SaleOrderDetailType>>,
  // lists send Mock.Product; getProduct adds `version` (withoutCost drops it for a role without Product Cost)
  Expect<Same<typeof Product, Mock.Product & { version?: number }>>,
  Expect<Same<typeof Movement, Mock.Movement>>,
  Expect<Same<typeof IssuedLine, Row<typeof listIssuedLines>>>,
  Expect<Same<typeof SystemUser, Mock.User>>,
  Expect<Same<typeof Permission, Mock.Permission>>,
  Expect<Same<typeof MasterRow, Mock.MasterRow>>,
  Expect<Same<typeof Symptom, Mock.Symptom>>,
  Expect<Same<typeof Model, Mock.Model>>,
  Expect<Same<typeof DocumentProfile, DocumentProfileType>>,
  Expect<Same<typeof ShippingProfile, ShippingProfileType>>,
  Expect<Same<typeof LinkStatus, LinkStatusType>>,
  Expect<Same<typeof PublicJob, PublicJobType>>,
  Expect<Same<typeof PublicJobSummary, PublicJobSummaryType>>,
  // GET /data/jobs?paged=1 — pageJobs' rows carry deposit / outstanding like the list's
  Expect<Same<ReturnType<typeof page<typeof Job>>, Page<JobListRow>>>,
  // answers declared with their operation
  Expect<Same<typeof OverdueAlertsBody, OverdueAlerts>>,
  Expect<Same<typeof PendingSaleOrdersBody, PendingSaleOrders>>,
  Expect<Same<typeof CallLog, Row<typeof listCallLogs>>>,
  Expect<Same<typeof StockCardLine, Row<typeof productStockCard>>>,
  Expect<Same<typeof MovementLine, Row<typeof movementLines>>>,
  Expect<Same<typeof SaleOrderPickLine, SoPickLine>>,
  Expect<Same<typeof ReturnableLine, ReturnLine>>,
];
