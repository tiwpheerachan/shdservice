import 'server-only';
import type { NextRequest } from 'next/server';
import { requireAdmin, requireUser, requireView, JOB_MODULES, HttpError } from '@/server/auth';
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
  type ProductFilters,
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
  listShopNames,
  symptomStats,
  modelSymptoms,
} from '@/server/services/jobs';
import { pageQuotations, listQuotations, quotationStatuses } from '@/server/services/quotations';
import { pageSaleOrders, listSaleOrders } from '@/server/services/sale-orders';

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
  sale_orders: ['Sale Order', 'Product Pick Stock'],
  movements: ['Product Onhand', 'Product Receive Stock', 'Product Pick Stock'],
  issued_lines: ['Report'],
  issued_stats: ['Report'],
  job_summary: ['Report'],
  quotation_summary: ['Report'],
  sale_order_summary: ['Report'],
};

/**
 * Read side for the UI hooks in src/data/db.ts. One endpoint per table name the
 * hooks already used, so the pages did not have to change their imports.
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
    return paged ? pageAudit(p, f) : listAudit({ ...f, q: p.q, limit: clampInt(sp.get('limit'), 500, 20000) });
  }
  if (resource === 'users' || resource === 'permissions' || resource === 'roles' || resource === 'modules') {
    await requireAdmin(req);
    if (resource === 'users') return listSystemUsers(deleted);
    if (resource === 'permissions') return listPermissions();
    if (resource === 'roles') return listRoles();
    return listModules();
  }

  const access = Object.hasOwn(READ_ACCESS, resource) ? READ_ACCESS[resource] : undefined;
  if (access) await requireView(req, access);
  else await requireUser(req);

  if (isSimpleKind(resource)) return listSimple(resource, deleted);
  switch (resource) {
    case 'symptoms':
      return listSymptoms(deleted);
    case 'models':
      return paged
        ? pageModels(p, deleted, { brand: p.f.brand, code: p.f.code, name: p.f.name, status: p.f.status })
        : listModels(deleted);
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
    case 'shop_names':
      return listShopNames();
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
      if (sp.get('fields') === 'lite') return listProductsLite(p.q);
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
        model: p.f.model,
        stock: p.f.stock === 'in' || p.f.stock === 'low' || p.f.stock === 'out' ? p.f.stock : undefined,
      };
      return paged ? pageProducts(p, pf) : listProducts({ deleted, q: p.q });
    }
    case 'product_stats': {
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
        model: p.f.model,
        stock: p.f.stock === 'in' || p.f.stock === 'low' || p.f.stock === 'out' ? p.f.stock : undefined,
      };
      return [await productStats(p.q, pf)];
    }
    case 'customers':
      return paged
        ? pageCustomers(p, deleted, customerFiltersFromQuery(p.f))
        : listCustomers({
            q: p.q,
            deleted,
            limit: clampInt(sp.get('limit'), 500, 5000),
            filters: customerFiltersFromQuery(p.f),
          });
    case 'issued_lines':
      return paged
        ? pageIssuedLines(p, { from: p.f.from, to: p.f.to, category: p.f.category, code: p.f.code })
        : listIssuedLines({
            from: p.f.from,
            to: p.f.to,
            category: p.f.category,
            code: p.f.code || p.q,
            limit: clampInt(sp.get('limit'), 5000, 20000),
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
            limit: clampInt(sp.get('limit'), 1000, 5000),
          }); // JSON stays 5k — 20k is for the Excel export
    case 'job_summary':
      return [await jobReportSummary(filtersFromQuery(p.f), p.q)];
    case 'quotation_summary':
      return [
        await quotationReportSummary(
          { status: p.f.status, from: p.f.from, to: p.f.to, deleted, jobNo: p.f.jobNo, type: p.f.type },
          p.q,
        ),
      ];
    case 'sale_order_summary':
      return [
        await saleOrderReportSummary(
          { approve: p.f.approve, from: p.f.from, to: p.f.to, sales: p.f.sales, deleted },
          p.q,
        ),
      ];
    case 'jobs':
      return paged
        ? pageJobs(p, filtersFromQuery(p.f))
        : listJobs({ ...filtersFromQuery(p.f), q: p.q, limit: clampInt(sp.get('limit'), 5000, 20000) });
    case 'quotations':
      return paged
        ? pageQuotations(p, {
            status: p.f.status,
            from: p.f.from,
            to: p.f.to,
            deleted,
            jobNo: p.f.jobNo,
            type: p.f.type,
            warranty: p.f.warranty,
            brand: p.f.brand,
          })
        : listQuotations({
            status: p.f.status,
            from: p.f.from,
            to: p.f.to,
            deleted,
            jobNo: p.f.jobNo,
            q: p.q,
            limit: clampInt(sp.get('limit'), 5000, 20000),
          });
    case 'sale_orders':
      return paged
        ? pageSaleOrders(p, {
            approve: p.f.approve,
            from: p.f.from,
            to: p.f.to,
            sales: p.f.sales,
            no: p.f.no,
            customer: p.f.customer,
            code: p.f.code,
            deleted,
          })
        : listSaleOrders({
            approve: p.f.approve,
            from: p.f.from,
            to: p.f.to,
            sales: p.f.sales,
            no: p.f.no,
            customer: p.f.customer,
            code: p.f.code,
            deleted,
            q: p.q,
            limit: clampInt(sp.get('limit'), 5000, 20000),
          });
    case 'dashboard':
      return [await dashboard({ from: p.f.from, to: p.f.to, type: p.f.type })];
    case 'job_stats':
      return [await jobStats()];
  }
  throw new HttpError(404, `unknown resource: ${resource}`);
}
