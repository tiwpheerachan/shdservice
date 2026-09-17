import "server-only";
import type { NextRequest } from "next/server";
import { requireAdmin, requireUser } from "@/server/auth";
import { pageAudit, listAudit, auditModules } from "@/server/audit";
import { parsePageQuery, type Page } from "@/server/paging";
import { parseStatusMode } from "@/server/record-status";
import { listSimple, isSimpleKind, listSymptoms, listModels, pageModels } from "@/server/services/masters";
import { listSystemUsers, listPermissions, listRoles, listModules, listStaff } from "@/server/services/users";
import { listCustomers, pageCustomers, listProvinces } from "@/server/services/customers";
import { listProducts, listMovements, listIssuedLines, pageProducts, productStats, listProductsLite, pageMovements, pageIssuedLines, issuedStats, type ProductFilters, jobsWithPendingParts, jobsWithReturnableParts } from "@/server/services/stock";
import { jobReportSummary, quotationReportSummary, saleOrderReportSummary } from "@/server/services/reports";
import { pageJobs, listJobs, filtersFromQuery, dashboard, jobStatuses, listOutsourceVendors, recentJobNos, jobStats, listJobTypeDetails, listShippers } from "@/server/services/jobs";
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
  if (resource === "audit_log" || resource === "audit_modules") {
    await requireAdmin(req);
    if (resource === "audit_modules") return auditModules();
    const f = { from: p.f.from, to: p.f.to, user: p.f.user, module: p.f.module, entity: p.f.entity, key: p.f.key, action: p.f.action };
    return paged ? pageAudit(p, f) : listAudit({ ...f, q: p.q, limit: Number(sp.get("limit") ?? 500) });
  }
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
      return paged ? pageModels(p, deleted) : listModels(deleted);
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
    case "job_type_details":
      return listJobTypeDetails();
    case "shippers":
      return listShippers();
    case "job_nos": {
      const mode = sp.get("mode");
      if (mode === "pending_parts") return jobsWithPendingParts(Number(sp.get("limit") ?? 300));
      if (mode === "returnable") return jobsWithReturnableParts(Number(sp.get("limit") ?? 300));
      return recentJobNos(Number(sp.get("limit") ?? 50));
    }
    case "products": {
      if (sp.get("fields") === "lite") return listProductsLite(p.q);
      const pf: ProductFilters = {
        mode: deleted,
        status: p.f.status,
        sysCode: p.f.sysCode,
        mfgCode: p.f.mfgCode,
        name: p.f.name,
        brand: p.f.brand,
        category: p.f.category,
        creator: p.f.creator,
        date: p.f.date,
        stock: p.f.stock === "in" || p.f.stock === "low" || p.f.stock === "out" ? p.f.stock : undefined,
      };
      return paged ? pageProducts(p, pf) : listProducts({ deleted, q: p.q });
    }
    case "product_stats": {
      const pf: ProductFilters = {
        mode: deleted,
        status: p.f.status,
        sysCode: p.f.sysCode,
        mfgCode: p.f.mfgCode,
        name: p.f.name,
        brand: p.f.brand,
        category: p.f.category,
        creator: p.f.creator,
        date: p.f.date,
        stock: p.f.stock === "in" || p.f.stock === "low" || p.f.stock === "out" ? p.f.stock : undefined,
      };
      return [await productStats(p.q, pf)];
    }
    case "customers":
      return paged ? pageCustomers(p, deleted) : listCustomers({ q: p.q, deleted, limit: Number(sp.get("limit") ?? 500) });
    case "issued_lines":
      return paged
        ? pageIssuedLines(p, { from: p.f.from, to: p.f.to, category: p.f.category, code: p.f.code })
        : listIssuedLines({ from: p.f.from, to: p.f.to, category: p.f.category, code: p.f.code || p.q, limit: Number(sp.get("limit") ?? 5000) });
    case "issued_stats":
      return [await issuedStats(p.q, { from: p.f.from, to: p.f.to, category: p.f.category, code: p.f.code })];
    case "movements":
      return paged
        ? pageMovements(p, { from: p.f.from, to: p.f.to, type: p.f.type, code: p.f.code, doc: p.f.doc, ref: p.f.ref })
        : listMovements({ q: p.q, from: p.f.from, to: p.f.to, type: p.f.type, limit: Number(sp.get("limit") ?? 1000) });
    case "job_summary":
      return [await jobReportSummary(filtersFromQuery(p.f), p.q)];
    case "quotation_summary":
      return [await quotationReportSummary({ status: p.f.status, from: p.f.from, to: p.f.to, deleted, jobNo: p.f.jobNo, type: p.f.type }, p.q)];
    case "sale_order_summary":
      return [await saleOrderReportSummary({ approve: p.f.approve, from: p.f.from, to: p.f.to, sales: p.f.sales, deleted }, p.q)];
    case "jobs":
      return paged ? pageJobs(p, filtersFromQuery(p.f)) : listJobs({ ...filtersFromQuery(p.f), q: p.q, limit: Number(sp.get("limit") ?? 5000) });
    case "quotations":
      return paged
        ? pageQuotations(p, { status: p.f.status, from: p.f.from, to: p.f.to, deleted, jobNo: p.f.jobNo, type: p.f.type, warranty: p.f.warranty, brand: p.f.brand })
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
