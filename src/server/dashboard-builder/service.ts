import 'server-only';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/server/db/client';
import { can } from '@/lib/rbac';
import { DashboardConfigSchema, DASHBOARD_TEMPLATES, emptyDashboardConfig, metricById, type DashboardConfig, type DashboardWidget, type WidgetData } from '@/lib/dashboard-builder';
import { DashboardFiltersSchema, parseFilters, type DashboardFilters } from '@/lib/filters';
import { buildBranchScope, rangeFor } from '@/server/filters/where-builder';
import { getOrders, getOrderLines } from '@/server/db/repositories/sales.repo';
import { getInventoryItems } from '@/server/db/repositories/inventory.repo';
import { getShipments } from '@/server/db/repositories/fulfillment.repo';
import { getCustomers } from '@/server/db/repositories/customers.repo';
import { getBatchRows } from '@/server/db/repositories/roastery.repo';
import { getPnlReport } from '@/server/finance/reports';
import { getBalanceSheetSnapshot } from '@/server/finance/balance-sheet';
import { getSpendRows, getSpendTotals, spendByCategory, spendByMonth, spendByParty } from '@/server/finance/spend';
import * as M from '@/lib/metrics';
import { enumLabel } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';

export type BuilderUser = { id: string; role: Role; branchId: string | null };

export interface DashboardSummary {
  id: string;
  name: string;
  description: string | null;
  visibility: 'PRIVATE' | 'SHARED';
  isDefault: boolean;
  isPinned: boolean;
  ownerName: string;
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
  updatedAt: Date;
}

export interface DashboardDetail extends DashboardSummary {
  config: DashboardConfig;
}

function ownerAdmin(role: Role): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

function canCreateDashboard(role: Role): boolean {
  return can(role, 'manage:dashboards');
}

function canSeeFinancialWidget(role: Role, metricId: string | undefined): boolean {
  if (!metricId) return true;
  const metric = metricById(metricId);
  if (!metric) return true;
  if (metric.source === 'finance') return can(role, 'view:finance');
  if (metric.id.startsWith('sales.') && metric.id !== 'sales.orders' && metric.id !== 'sales.units') return can(role, 'view:sales');
  if (metric.source === 'inventory') return can(role, 'view:inventory');
  if (metric.source === 'customers') return can(role, 'view:customers');
  if (metric.source === 'fulfillment') return can(role, 'view:fulfillment');
  if (metric.source === 'roastery') return can(role, 'view:roastery');
  return can(role, 'view:dashboard');
}

function parseConfig(value: Prisma.JsonValue): DashboardConfig {
  const parsed = DashboardConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyDashboardConfig();
}

function accessFlags(row: {
  ownerId: string;
  shares: { userId: string | null; role: Role | null; canEdit: boolean; canExport: boolean }[];
}, user: BuilderUser) {
  const owned = row.ownerId === user.id;
  const admin = ownerAdmin(user.role);
  const share = row.shares.find((s) => s.userId === user.id) ?? row.shares.find((s) => s.role === user.role);
  return {
    canEdit: admin || owned || Boolean(share?.canEdit),
    canDelete: admin || owned,
    canExport: admin || owned || can(user.role, 'export:dashboards') || Boolean(share?.canExport),
  };
}

function dashboardWhere(user: BuilderUser): Prisma.DashboardWhereInput {
  if (ownerAdmin(user.role)) return { deletedAt: null };
  return {
    deletedAt: null,
    OR: [
      { ownerId: user.id },
      { visibility: 'SHARED' },
      { shares: { some: { OR: [{ userId: user.id }, { role: user.role }] } } },
    ],
  };
}

export async function listDashboards(user: BuilderUser): Promise<DashboardSummary[]> {
  const rows = await prisma.dashboard.findMany({
    where: dashboardWhere(user),
    include: {
      owner: { select: { name: true } },
      shares: { select: { userId: true, role: true, canEdit: true, canExport: true } },
    },
    orderBy: [{ isPinned: 'desc' }, { updatedAt: 'desc' }],
  });
  return rows.map((row) => ({ ...row, ownerName: row.owner.name, ...accessFlags(row, user) }));
}

export async function getDashboard(user: BuilderUser, id: string): Promise<DashboardDetail | null> {
  const row = await prisma.dashboard.findFirst({
    where: { id, ...dashboardWhere(user) },
    include: {
      owner: { select: { name: true } },
      shares: { select: { userId: true, role: true, canEdit: true, canExport: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    isDefault: row.isDefault,
    isPinned: row.isPinned,
    ownerName: row.owner.name,
    updatedAt: row.updatedAt,
    config: parseConfig(row.draftConfig ?? row.config),
    ...accessFlags(row, user),
  };
}

export async function createDashboardFromTemplate(user: BuilderUser, input: {
  name: string;
  description?: string;
  templateKey?: string;
}): Promise<string> {
  if (!canCreateDashboard(user.role)) throw new Error('forbidden');
  const template = DASHBOARD_TEMPLATES.find((item) => item.key === input.templateKey);
  const config = template?.config ?? emptyDashboardConfig();
  const row = await prisma.dashboard.create({
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || template?.descriptionEn || null,
      ownerId: user.id,
      visibility: 'PRIVATE',
      config: config as Prisma.InputJsonValue,
      draftConfig: config as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return row.id;
}

export async function updateDashboard(user: BuilderUser, id: string, input: {
  name?: string;
  description?: string | null;
  config?: DashboardConfig;
  saveDraftOnly?: boolean;
  visibility?: 'PRIVATE' | 'SHARED';
  isPinned?: boolean;
}) {
  const dashboard = await getDashboard(user, id);
  if (!dashboard?.canEdit) throw new Error('forbidden');
  const data: Prisma.DashboardUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.description !== undefined) data.description = input.description?.trim() || null;
  if (input.visibility !== undefined && (ownerAdmin(user.role) || dashboard.canDelete)) data.visibility = input.visibility;
  if (input.isPinned !== undefined) data.isPinned = input.isPinned;
  if (input.config) {
    const parsed = DashboardConfigSchema.parse(input.config);
    data.draftConfig = parsed as Prisma.InputJsonValue;
    if (!input.saveDraftOnly) data.config = parsed as Prisma.InputJsonValue;
  }
  await prisma.dashboard.update({ where: { id }, data });
}

export async function duplicateDashboard(user: BuilderUser, id: string): Promise<string> {
  if (!canCreateDashboard(user.role)) throw new Error('forbidden');
  const source = await getDashboard(user, id);
  if (!source) throw new Error('not-found');
  const row = await prisma.dashboard.create({
    data: {
      name: `${source.name} copy`,
      description: source.description,
      ownerId: user.id,
      visibility: 'PRIVATE',
      config: source.config as Prisma.InputJsonValue,
      draftConfig: source.config as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return row.id;
}

export async function deleteDashboard(user: BuilderUser, id: string) {
  const dashboard = await getDashboard(user, id);
  if (!dashboard?.canDelete) throw new Error('forbidden');
  await prisma.dashboard.update({ where: { id }, data: { deletedAt: new Date() } });
}

function parseConfigFilters(input: DashboardConfig['globalFilters'] | DashboardWidget['filters']): DashboardFilters {
  return DashboardFiltersSchema.parse(parseFilters(input ?? {}));
}

function mergeFilters(base: DashboardFilters, widget: DashboardWidget): DashboardFilters {
  return DashboardFiltersSchema.parse({ ...base, ...parseConfigFilters(widget.filters) });
}

function bucketRows(rows: { key: string; amount: number }[]) {
  return rows.map((row) => ({ label: row.key, value: row.amount }));
}

function empty(message = 'No data found for the selected filters.'): WidgetData {
  return { kind: 'empty', message };
}

export async function resolveWidgetData(user: BuilderUser, widget: DashboardWidget, filters: DashboardFilters, locale: AppLocale): Promise<WidgetData> {
  if (widget.type === 'text') return { kind: 'text', body: widget.text ?? widget.description ?? '' };
  if (widget.type === 'section') return { kind: 'text', body: widget.description ?? widget.title };
  if (!widget.metric) return empty('Select a metric to show this widget.');
  if (!canSeeFinancialWidget(user.role, widget.metric)) return empty('You do not have access to this widget.');

  const metric = metricById(widget.metric);
  if (!metric) return empty('Metric is not available.');
  const scopedFilters = mergeFilters(filters, widget);
  const scope = buildBranchScope(user);
  const range = rangeFor(scopedFilters);

  if (metric.source === 'sales') {
    const [orders, lines] = await Promise.all([getOrders(scopedFilters, scope, range), getOrderLines(scopedFilters, scope, range)]);
    const net = M.netSales(orders);
    const orderCount = M.salesOrderCount(orders);
    if (metric.id === 'sales.netSales') return { kind: 'kpi', value: net, valueKind: 'iqd' };
    if (metric.id === 'sales.orders') return { kind: 'kpi', value: orderCount, valueKind: 'count' };
    if (metric.id === 'sales.aov') return { kind: 'kpi', value: M.aov(net, orderCount), valueKind: 'iqd' };
    if (metric.id === 'sales.avgOrdersPerDay') return { kind: 'kpi', value: M.averageOrdersPerDay(orders, range), valueKind: 'count' };
    if (metric.id === 'sales.units') return { kind: 'kpi', value: M.unitsSold(lines), valueKind: 'count' };
    if (metric.id === 'sales.discount') return { kind: 'kpi', value: M.discountEffect(orders).discountSpend, valueKind: 'iqd' };
    if (metric.id === 'sales.trend') return { kind: 'series', valueKind: 'iqd', points: M.salesTimeSeries(orders, 'day').map((p) => ({ label: p.label, value: p.netSales })) };
    if (metric.id === 'sales.byChannel') return { kind: 'series', valueKind: 'iqd', points: M.salesByDimension(orders, 'channel').map((p) => ({ label: enumLabel(p.key, locale), value: p.netSales })) };
    if (metric.id === 'sales.byCity') return { kind: 'series', valueKind: 'iqd', points: M.salesByDimension(orders, 'governorate').map((p) => ({ label: enumLabel(p.key, locale), value: p.netSales })) };
    if (metric.id === 'sales.byProduct') {
      const rows = M.topProducts(lines, 12);
      if (widget.type === 'table') return { kind: 'table', columns: ['Product', 'SKU', 'Units', 'Net sales'], rows: rows.map((p) => [p.name[locale], p.sku, p.units, p.netSales]) };
      return { kind: 'series', valueKind: 'iqd', points: rows.map((p) => ({ label: p.name[locale], value: p.netSales })) };
    }
    if (metric.id === 'sales.byGroup') return { kind: 'series', valueKind: 'iqd', points: M.salesByGroup(lines).slice(0, 12).map((p) => ({ label: locale === 'ar' ? p.nameAr : p.nameEn, value: p.netSales })) };
  }

  if (metric.source === 'finance') {
    const [pnl, balance, spendTotals] = await Promise.all([
      getPnlReport(scopedFilters, scope, range),
      getBalanceSheetSnapshot({ filters: scopedFilters, scope, asOf: range.end }),
      getSpendTotals(scopedFilters, scope, range),
    ]);
    if (metric.id === 'finance.revenue') return { kind: 'kpi', value: pnl.netSales, valueKind: 'iqd' };
    if (metric.id === 'finance.totalSpent') return { kind: 'kpi', value: spendTotals.totalSpent, valueKind: 'iqd' };
    if (metric.id === 'finance.capex') return { kind: 'kpi', value: spendTotals.capex, valueKind: 'iqd' };
    if (metric.id === 'finance.opex') return { kind: 'kpi', value: spendTotals.opex, valueKind: 'iqd' };
    if (metric.id === 'finance.cogs') return { kind: 'kpi', value: spendTotals.cogs, valueKind: 'iqd' };
    if (metric.id === 'finance.grossProfit') return { kind: 'kpi', value: pnl.grossProfit, valueKind: 'iqd' };
    if (metric.id === 'finance.grossMargin') return { kind: 'kpi', value: pnl.grossMarginPct, valueKind: 'percent' };
    if (metric.id === 'finance.contributionProfit') return { kind: 'kpi', value: pnl.contributionProfit, valueKind: 'iqd' };
    if (metric.id === 'finance.operatingProfit') return { kind: 'kpi', value: pnl.operatingProfit, valueKind: 'iqd' };
    if (metric.id === 'finance.inventoryPurchases') return { kind: 'kpi', value: spendTotals.inventory, valueKind: 'iqd' };
    if (metric.id === 'finance.directSellingCosts') return { kind: 'kpi', value: spendTotals.direct, valueKind: 'iqd' };
    if (metric.id === 'finance.cash') return { kind: 'kpi', value: balance.combinedIqd.cashBank, valueKind: 'iqd' };
    if (metric.id === 'finance.receivables') return { kind: 'kpi', value: balance.combinedIqd.receivables, valueKind: 'iqd' };
    if (metric.id === 'finance.payables') return { kind: 'kpi', value: balance.combinedIqd.payables, valueKind: 'iqd' };
    const allSpendRows = await getSpendRows('all', scopedFilters, scope, range);
    if (metric.id === 'finance.spendByMonth') return { kind: 'series', valueKind: 'iqd', points: bucketRows(spendByMonth(allSpendRows)) };
    if (metric.id === 'finance.spendByCategory') return { kind: 'series', valueKind: 'iqd', points: bucketRows(spendByCategory(allSpendRows)) };
    if (metric.id === 'finance.spendByParty') {
      const rows = spendByParty(allSpendRows).slice(0, 12);
      if (widget.type === 'table') return { kind: 'table', columns: ['Party', 'Amount'], rows: rows.map((row) => [row.key, row.amount]) };
      return { kind: 'series', valueKind: 'iqd', points: bucketRows(rows) };
    }
  }

  if (metric.source === 'inventory') {
    const items = await getInventoryItems(scopedFilters, scope, range);
    const stockRows = items.map(M.stockRow);
    if (metric.id === 'inventory.value') return { kind: 'kpi', value: stockRows.reduce((sum, row) => sum + row.value, 0), valueKind: 'iqd' };
    if (metric.id === 'inventory.stock') {
      if (widget.type === 'table') return { kind: 'table', columns: ['Item', 'Stock', 'Unit', 'Value'], rows: stockRows.slice(0, 50).map((row) => [row.item.nameEn, row.current, row.item.unit, Math.round(row.value)]) };
      return { kind: 'kpi', value: stockRows.reduce((sum, row) => sum + Math.max(0, row.current), 0), valueKind: 'count' };
    }
    if (metric.id === 'inventory.lowStock') {
      const low = stockRows.filter((row) => row.belowReorder);
      if (widget.type === 'table') return { kind: 'table', columns: ['Item', 'Stock', 'Reorder point'], rows: low.map((row) => [row.item.nameEn, row.current, row.item.reorderPoint ?? '—']) };
      return { kind: 'kpi', value: low.length, valueKind: 'count' };
    }
    if (metric.id === 'inventory.byCategory') return { kind: 'series', valueKind: 'iqd', points: M.stockValueByCategory(items).map((row) => ({ label: enumLabel(row.category, locale), value: Math.round(row.value) })) };
  }

  if (metric.source === 'customers') {
    const [customers, orders] = await Promise.all([getCustomers(scope), getOrders(scopedFilters, scope, range)]);
    const active = M.uniqueActiveCustomers(orders);
    if (metric.id === 'customers.total') return { kind: 'kpi', value: active, valueKind: 'count' };
    if (metric.id === 'customers.repeat') return { kind: 'kpi', value: customers.filter((c) => c.ordersCount > 1).length, valueKind: 'count' };
    if (metric.id === 'customers.byCity') return { kind: 'series', valueKind: 'count', points: M.customersByCity(customers).map((row) => ({ label: enumLabel(row.governorate, locale), value: row.count })) };
    if (metric.id === 'customers.top') {
      const rows = await prisma.customer.findMany({
        where: scope.branchId ? { orders: { some: { branchId: scope.branchId } } } : {},
        select: { externalId: true, nameEn: true, nameAr: true, orders: { select: { grossAmount: true, discountAmount: true, refundAmount: true, status: true } } },
        take: 50,
      });
      return { kind: 'table', columns: ['Customer', 'Orders', 'Sales'], rows: rows.map((row) => {
        const sales = row.orders.reduce((sum, order) => sum + order.grossAmount - order.discountAmount - order.refundAmount, 0);
        return [row.nameEn || row.nameAr || row.externalId || '—', row.orders.length, sales];
      }).sort((a, b) => Number(b[2]) - Number(a[2])).slice(0, 12) };
    }
  }

  if (metric.source === 'fulfillment') {
    const shipments = await getShipments(scopedFilters, scope, range);
    if (metric.id === 'fulfillment.delivered') return { kind: 'kpi', value: shipments.filter((s) => s.status === 'DELIVERED').length, valueKind: 'count' };
    if (metric.id === 'fulfillment.open') {
      const open = shipments.filter((s) => s.status !== 'DELIVERED' && s.status !== 'RETURNED' && s.status !== 'FAILED');
      if (widget.type === 'table') return { kind: 'table', columns: ['Courier', 'Status', 'City'], rows: open.slice(0, 30).map((s) => [s.courier, s.status, enumLabel(s.governorate, locale)]) };
      return { kind: 'kpi', value: open.length, valueKind: 'count' };
    }
    if (metric.id === 'fulfillment.completionRate') return { kind: 'kpi', value: shipments.length ? shipments.filter((s) => s.status === 'DELIVERED').length / shipments.length : 0, valueKind: 'percent' };
    if (metric.id === 'fulfillment.byStatus') {
      const map = new Map<string, number>();
      for (const s of shipments) map.set(s.status, (map.get(s.status) ?? 0) + 1);
      return { kind: 'series', valueKind: 'count', points: [...map.entries()].map(([label, value]) => ({ label: enumLabel(label, locale), value })) };
    }
    if (metric.id === 'fulfillment.byCourier') {
      const rows = M.courierComparison(shipments).slice(0, 12);
      if (widget.type === 'table') return { kind: 'table', columns: ['Courier', 'Shipments', 'Delivered', 'Failed'], rows: rows.map((row) => [row.courier, row.shipments, row.delivered, row.failed]) };
      return { kind: 'series', valueKind: 'count', points: rows.map((row) => ({ label: row.courier, value: row.shipments })) };
    }
  }

  if (metric.source === 'roastery') {
    const batches = await getBatchRows(scopedFilters, scope, range);
    const green = batches.reduce((sum, row) => sum + row.greenInputGrams, 0);
    const roasted = batches.reduce((sum, row) => sum + (row.roastedOutputGrams ?? 0), 0);
    if (metric.id === 'roastery.batches') return { kind: 'kpi', value: batches.length, valueKind: 'count' };
    if (metric.id === 'roastery.greenInput') return { kind: 'kpi', value: green, valueKind: 'grams' };
    if (metric.id === 'roastery.roastedOutput') return { kind: 'kpi', value: roasted, valueKind: 'grams' };
    if (metric.id === 'roastery.yield') return { kind: 'kpi', value: M.roastingYieldPct(green, roasted), valueKind: 'percent' };
    if (metric.id === 'roastery.batchHistory') return { kind: 'table', columns: ['Batch', 'Date', 'Origin', 'Green g', 'Roasted g'], rows: batches.map((row) => [row.batchNumber, row.roastDate?.toISOString().slice(0, 10) ?? '—', row.origin, row.greenInputGrams, row.roastedOutputGrams ?? 0]) };
  }

  return empty();
}

export async function resolveDashboardWidgetData(user: BuilderUser, config: DashboardConfig, locale: AppLocale) {
  const filters = parseConfigFilters(config.globalFilters);
  return Promise.all(config.widgets.map(async (widget) => ({ widgetId: widget.id, data: await resolveWidgetData(user, widget, filters, locale) })));
}

export { DASHBOARD_TEMPLATES };
