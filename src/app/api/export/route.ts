import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/server/auth/session';
import { can, type Capability } from '@/lib/rbac';
import { parseFilters } from '@/lib/filters';
import { buildBranchScope, rangeFor } from '@/server/filters/where-builder';
import { getOrders, getOrderLines } from '@/server/db/repositories/sales.repo';
import { getInventoryItems } from '@/server/db/repositories/inventory.repo';
import { toCsv } from '@/server/export/csv';
import * as M from '@/lib/metrics';
import type { AppLocale } from '@/lib/money';
import { enumLabel } from '@/lib/enums';
import { formatDate } from '@/lib/dates';
import { prisma } from '@/server/db/client';

const DATASET_CAPABILITY: Record<string, Capability> = {
  orders: 'view:sales',
  top_products: 'view:sales',
  product_margin: 'export:financial',
  inventory: 'view:inventory',
};

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const params = req.nextUrl.searchParams;
  const dataset = params.get('dataset') ?? 'orders';
  const locale = (params.get('locale') ?? 'en') as AppLocale;
  const capability = DATASET_CAPABILITY[dataset];
  if (!capability || !can(user.role, capability)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const sp = Object.fromEntries(params.entries());
  const filters = parseFilters(sp);
  const scope = buildBranchScope(user);
  const range = rangeFor(filters);

  let headers: string[] = [];
  let rows: (string | number)[][] = [];

  switch (dataset) {
    case 'product_margin': {
      const lines = await getOrderLines(filters, scope, range);
      headers = ['SKU', 'Product', 'Units', 'NetSales_IQD', 'COGS_IQD', 'Margin_IQD', 'Margin_%'];
      rows = M.productMargin(lines).map((r) => [
        r.sku,
        r.name[locale],
        r.units,
        r.netSales,
        r.cogs,
        r.marginAmount,
        (r.marginPct * 100).toFixed(1),
      ]);
      break;
    }
    case 'top_products': {
      const lines = await getOrderLines(filters, scope, range);
      headers = ['SKU', 'Product', 'Units', 'NetSales_IQD'];
      rows = M.topProducts(lines, 100).map((r) => [r.sku, r.name[locale], r.units, r.netSales]);
      break;
    }
    case 'inventory': {
      const items = await getInventoryItems(filters, scope, range);
      headers = ['Item', 'Category', 'Unit', 'Opening', 'Additions', 'Deductions', 'Current', 'CoverageDays', 'Value_IQD'];
      rows = items.map((it) => {
        const row = M.stockRow(it);
        const oc = M.openingClosing(it.movements, range.start, range.end);
        return [
          locale === 'ar' ? it.nameAr : it.nameEn,
          enumLabel(it.category, locale),
          it.unit,
          oc.opening,
          oc.additions,
          oc.deductions,
          row.current,
          row.coverageDays == null ? '' : Math.round(row.coverageDays),
          row.value,
        ];
      });
      break;
    }
    default: {
      const orders = await getOrders(filters, scope, range);
      headers = ['OrderDate', 'Channel', 'City', 'Status', 'Gross_IQD', 'Discount_IQD', 'Refund_IQD', 'Net_IQD'];
      rows = orders.map((o) => [
        formatDate(o.placedAt, locale),
        enumLabel(o.channel, locale),
        enumLabel(o.governorate, locale),
        enumLabel(o.status, locale),
        o.grossAmount,
        o.discountAmount,
        o.refundAmount,
        o.grossAmount - o.discountAmount - o.refundAmount,
      ]);
    }
  }

  await prisma.auditLog.create({
    data: { userId: user.id, action: 'EXPORT', entity: dataset, metadata: { rows: rows.length } },
  });

  const csv = toCsv(headers, rows);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="laheeb-${dataset}.csv"`,
    },
  });
}
