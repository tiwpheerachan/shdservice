import 'server-only';
import type { NextRequest } from 'next/server';
import { requireAdmin, requireUser, requireView, JOB_MODULES, SALE_ORDER_READERS, HttpError } from '@/server/auth';
import type { Module } from '@/lib/modules';
import { pageAudit, listAudit, auditModules } from '@/server/audit';
import { clampInt, parsePageQuery, searchOf, type Page } from '@/server/paging';
import { parseStatusMode } from '@/server/record-status';
import { listSimple, isSimpleKind, listSymptoms, listModels, pageModels } from '@/server/services/masters';
import { listSystemUsers, listPermissions, listRoles, listModules, listStaff } from '@/server/services/users';
import { listCustomers, pageCustomers, listProvinces, customerFiltersFromQuery } from '@/server/services/customers';
import {
  listProducts,
  listMovements,
  listIssuedLines,
  pageProducts,
  productStats,
  listProductsLite,
  pageMovements,
  pageIssuedLines,
  issuedStats,
  productFiltersFromQuery,
  jobsWithPendingParts,
  jobsWithReturnableParts,
} from '@/server/services/stock';
import { jobReportSummary, quotationReportSummary, saleOrderReportSummary } from '@/server/services/reports';
import { listDocumentProfiles } from '@/server/services/document-profiles';
import { listShippingProfiles } from '@/server/services/shipping-profiles';
import {
  pageJobs,
  listJobs,
  filtersFromQuery,
  dashboard,
  jobStatuses,
  listOutsourceVendors,
  recentJobNos,
  jobStats,
  listJobTypeDetails,
  listShippers,
  symptomStats,
  modelSymptoms,
} from '@/server/services/jobs';
import {
  pageQuotations,
  listQuotations,
  quotationStatuses,
  quotationFiltersFromQuery,
} from '@/server/services/quotations';
import { pageSaleOrders, listSaleOrders, saleOrderFiltersFromQuery } from '@/server/services/sale-orders';

/**
 * Resources holding customer / document data: which screens may read them ("view"
 * on any one of the modules). Lists the screens that actually call each one, so a
 * form that reads across modules (e.g. stock pick → sale orders) keeps working.
 * Report = only the report pages use it (special right Report). Anything not listed is a
 * lookup (statuses, masters, staff names, product catalog) open to every approved user.
 */
const READ_ACCESS: Record<string, readonly Module[]> = {
  customers: ['Customer'],
  jobs: JOB_MODULES,
  job_stats: ['Job Management'],
  dashboard: ['Job Management'],
  quotations: ['Quotation'],
  sale_orders: SALE_ORDER_READERS,
  movements: ['Product Onhand', 'Product Receive Stock', 'Product Pick Stock'],
  issued_lines: ['Report'],
  issued_stats: ['Report'],
  job_summary: ['Report'],
  quotation_summary: ['Report'],
  sale_order_summary: ['Report'],
};

/**
 * Row cap of every unpaged list here: these answer with view rights alone, so they stay screen-sized
 * (the UI asks for 6 / 200 at most). A bigger set is the Excel export's (src/server/export.ts calls the
 * list functions itself with MAX_EXPORT_ROWS), which needs the Export right and streams the file.
 */
const LIST_DEFAULT = 200;
const LIST_MAX = 1000;

/**
 * Read side for the UI hooks in src/data/db.ts, one resource per table name the hooks use.
 * Returns either a plain array or, with ?paged=1, a { rows, total } page.
 * `query` = the request's query as the resource's operation parsed it (any other name is a filter).
 */
export async function readResource(
  req: NextRequest,
  resource: string,
  query: Record<string, unknown>,
): Promise<unknown[] | Page<unknown>> {
  const sp = searchOf(query);
  const deleted = parseStatusMode(sp.get('deleted'));
  const paged = sp.get('paged') === '1';
  const p = parsePageQuery(sp);
  const limit = clampInt(sp.get('limit'), LIST_DEFAULT, LIST_MAX);

  // admin-only resources
  if (resource === 'audit_log' || resource === 'audit_modules') {
    await requireAdmin(req);
    if (resource === 'audit_modules') return auditModules();
    const f = {
      from: p.f.from,
      to: p.f.to,
      user: p.f.user,
      module: p.f.module,
      entity: p.f.entity,
      key: p.f.key,
      action: p.f.action,
    };
    return paged ? pageAudit(p, f) : listAudit({ ...f, q: p.q, limit });
  }
  if (resource === 'users' || resource === 'permissions' || resource === 'roles' || resource === 'modules') {
    await requireAdmin(req);
    if (resource === 'users') return listSystemUsers(deleted);
    if (resource === 'permissions') return listPermissions();
    if (resource === 'roles') return listRoles();
    return listModules();
  }

  const access = Object.hasOwn(READ_ACCESS, resource) ? READ_ACCESS[resource] : undefined;
  const user = access ? await requireView(req, access) : await requireUser(req);

  if (isSimpleKind(resource)) return listSimple(resource, deleted);
  switch (resource) {
    case 'symptoms':
      return listSymptoms(deleted);
    case 'models':
      // unpaged ?brand= → that brand's models only (a picker whose brand is chosen), from the same cached list
      return paged
        ? pageModels(p, deleted, { brand: p.f.brand, code: p.f.code, name: p.f.name, status: p.f.status })
        : listModels(deleted).then((rows) => (p.f.brand ? rows.filter((m) => m.brand === p.f.brand) : rows));
    case 'staff': {
      const usedAs = sp.get('usedAs');
      return listStaff(usedAs === 'engineer' || usedAs === 'sales' ? usedAs : undefined);
    }
    case 'provinces':
      return listProvinces();
    case 'job_statuses':
      return jobStatuses();
    case 'quotation_statuses':
      return quotationStatuses();
    case 'vendors':
      return listOutsourceVendors();
    case 'job_type_details':
      return listJobTypeDetails();
    case 'symptom_stats':
      return symptomStats();
    case 'model_symptoms':
      return modelSymptoms(sp.get('model') ?? '');
    case 'shippers':
      return listShippers();
    case 'document_profiles':
      return listDocumentProfiles(true);
    case 'shipping_profiles':
      return listShippingProfiles(true);
    case 'job_nos': {
      const mode = sp.get('mode');
      if (mode === 'pending_parts') return jobsWithPendingParts(clampInt(sp.get('limit'), 300, 1000));
      if (mode === 'returnable') return jobsWithReturnableParts(clampInt(sp.get('limit'), 300, 1000));
      return recentJobNos(clampInt(sp.get('limit'), 50, 1000));
    }
    case 'products': {
      // lite: ACTIVE (pickers), INACTIVE too only when asked (stock receive) — never DELETED
      if (sp.get('fields') === 'lite')
        return listProductsLite(p.q, sp.get('deleted') === 'exclude' ? 'exclude' : 'active');
      return paged ? pageProducts(p, productFiltersFromQuery(p.f, deleted)) : listProducts({ deleted, q: p.q });
    }
    case 'product_stats':
      return [await productStats(p.q, productFiltersFromQuery(p.f, deleted))];
    case 'customers': {
      // deleted customers (PDPA: erased on request) are System Admin's alone — anyone else gets the live list
      const mode = !user.isAdmin && (deleted === 'only' || deleted === 'all') ? 'exclude' : deleted;
      return paged
        ? pageCustomers(p, mode, customerFiltersFromQuery(p.f))
        : listCustomers({
            q: p.q,
            deleted: mode,
            limit,
            filters: customerFiltersFromQuery(p.f),
          });
    }
    case 'issued_lines':
      return paged
        ? pageIssuedLines(p, { from: p.f.from, to: p.f.to, category: p.f.category, code: p.f.code })
        : listIssuedLines({
            from: p.f.from,
            to: p.f.to,
            category: p.f.category,
            code: p.f.code || p.q,
            limit,
          });
    case 'issued_stats':
      return [await issuedStats(p.q, { from: p.f.from, to: p.f.to, category: p.f.category, code: p.f.code })];
    case 'movements':
      return paged
        ? pageMovements(p, { from: p.f.from, to: p.f.to, type: p.f.type, code: p.f.code, doc: p.f.doc, ref: p.f.ref })
        : listMovements({
            q: p.q,
            from: p.f.from,
            to: p.f.to,
            type: p.f.type,
            code: p.f.code,
            doc: p.f.doc,
            ref: p.f.ref,
            limit,
          });
    case 'job_summary':
      return [await jobReportSummary(filtersFromQuery(p.f), p.q)];
    case 'quotation_summary':
      return [await quotationReportSummary(quotationFiltersFromQuery(p.f, deleted), p.q)];
    case 'sale_order_summary':
      return [await saleOrderReportSummary(saleOrderFiltersFromQuery(p.f, deleted), p.q)];
    case 'jobs':
      return paged ? pageJobs(p, filtersFromQuery(p.f)) : listJobs({ ...filtersFromQuery(p.f), q: p.q, limit });
    case 'quotations':
      return paged
        ? pageQuotations(p, quotationFiltersFromQuery(p.f, deleted))
        : listQuotations({
            ...quotationFiltersFromQuery(p.f, deleted),
            q: p.q,
            limit,
          });
    case 'sale_orders':
      return paged
        ? pageSaleOrders(p, saleOrderFiltersFromQuery(p.f, deleted))
        : listSaleOrders({
            ...saleOrderFiltersFromQuery(p.f, deleted),
            q: p.q,
            limit,
          });
    case 'dashboard':
      return [await dashboard({ from: p.f.from, to: p.f.to, type: p.f.type })];
    case 'job_stats':
      return [await jobStats()];
  }
  throw new HttpError(404, `unknown resource: ${resource}`);
}
