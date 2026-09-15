import "server-only";
import type { NextRequest } from "next/server";
import { requireAdmin, requireUser } from "@/server/auth";
import { parsePageQuery, type Page } from "@/server/paging";
import { parseStatusMode } from "@/server/record-status";
import { listSimple, isSimpleKind, listSymptoms, listModels } from "@/server/services/masters";
import { listSystemUsers, listPermissions, listRoles, listModules, listStaff } from "@/server/services/users";
import { listCustomers, pageCustomers, listProvinces } from "@/server/services/customers";
import { listProducts, listMovements, listIssuedLines } from "@/server/services/stock";
import { pageJobs, listJobs, filtersFromQuery, dashboard, jobStatuses, listOutsourceVendors, recentJobNos, jobStats } from "@/server/services/jobs";
import { pageQuotations, listQuotations, quotationStatuses } from "@/server/services/quotations";
import { pageSaleOrders, listSaleOrders } from "@/server/services/sale-orders";


/**
 * Read side for the UI hooks in src/data/db.ts. One endpoint per table name the
 * hooks already used, so the pages did not have to change their imports.
 * Returns either a plain array or, with ?paged=1, a { rows, total } page.
 */
export async function readResource(req: NextRequest, resource: string): Promise<unknown[] | Page<unknown>> {
  const sp = new URL(req.url).searchParams;
  const deleted = parseStatusMode(sp.get("deleted"));
  const paged = sp.get("paged") === "1";
  const p = parsePageQuery(sp);

  // admin-only resources
  if (resource === "users" || resource === "permissions" || resource === "roles" || resource === "modules") {
    await requireAdmin(req);
    if (resource === "users") return listSystemUsers(deleted);
    if (resource === "permissions") return listPermissions();
    if (resource === "roles") return listRoles();
    return listModules();
  }

  await requireUser(req);

  if (isSimpleKind(resource)) return listSimple(resource, deleted);
  switch (resource) {
    case "symptoms":
      return listSymptoms(deleted);
    case "models":
      return listModels(deleted);
    case "staff":
      return listStaff();
    case "provinces":
      return listProvinces();
    case "job_statuses":
      return jobStatuses();
    case "quotation_statuses":
      return quotationStatuses();
    case "vendors":
      return listOutsourceVendors();
    case "job_nos":
      return recentJobNos(Number(sp.get("limit") ?? 50));
    case "products":
      return listProducts({ deleted, q: p.q });
    case "customers":
      return paged ? pageCustomers(p, deleted) : listCustomers({ q: p.q, deleted, limit: Number(sp.get("limit") ?? 500) });
    case "issued_lines":
      return listIssuedLines({ from: p.f.from, to: p.f.to, category: p.f.category, code: p.f.code || p.q, limit: Number(sp.get("limit") ?? 5000) });
    case "movements":
      return listMovements({ q: p.q, from: p.f.from, to: p.f.to, type: p.f.type, limit: Number(sp.get("limit") ?? 1000) });
    case "jobs":
      return paged ? pageJobs(p, filtersFromQuery(p.f)) : listJobs({ ...filtersFromQuery(p.f), q: p.q, limit: Number(sp.get("limit") ?? 5000) });
    case "quotations":
      return paged
        ? pageQuotations(p, { status: p.f.status, from: p.f.from, to: p.f.to, deleted, jobNo: p.f.jobNo })
        : listQuotations({ status: p.f.status, from: p.f.from, to: p.f.to, deleted, jobNo: p.f.jobNo, q: p.q, limit: Number(sp.get("limit") ?? 5000) });
    case "sale_orders":
      return paged
        ? pageSaleOrders(p, { approve: p.f.approve, from: p.f.from, to: p.f.to, sales: p.f.sales, deleted })
        : listSaleOrders({ approve: p.f.approve, from: p.f.from, to: p.f.to, sales: p.f.sales, deleted, q: p.q, limit: Number(sp.get("limit") ?? 5000) });
    case "dash_groups":
      return (await dashboard()).groups;
    case "tat_rows":
      return (await dashboard()).tat;
    case "monthly":
      return (await dashboard()).monthly;
    case "top_symptoms":
      return (await dashboard()).topSymptoms;
    case "dashboard":
      return [await dashboard()];
    case "job_stats":
      return [await jobStats()];
  }
  throw Object.assign(new Error(`unknown resource: ${resource}`), { status: 404 });
}
