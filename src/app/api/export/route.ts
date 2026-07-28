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
import { groupInvoiceFinanceEntries, invoicePaymentSnapshot } from '@/lib/invoice';

const DATASET_CAPABILITY: Record<string, Capability> = {
  orders: 'view:sales',
  top_products: 'view:sales',
  product_margin: 'export:financial',
  inventory: 'view:inventory',
  variations: 'manage:products',
  sales_by_group: 'view:sales',
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
    case 'variations': {
      const products = await prisma.product.findMany({
        orderBy: { sku: 'asc' },
        include: { group: { select: { nameEn: true, nameAr: true } } },
      });
      headers = ['SKU', 'Retail_EAN13', 'Product', 'Group', 'Size', 'Grind', 'SellingPrice_IQD', 'Cost_IQD', 'Status'];
      rows = products.map((p) => [
        p.sku,
        p.retailBarcode,
        locale === 'ar' ? p.nameAr : p.nameEn,
        p.group ? (locale === 'ar' ? p.group.nameAr : p.group.nameEn) : '',
        p.sizeLabel,
        enumLabel(p.grind, locale),
        p.sellingPrice,
        p.cogsPerUnit,
        p.isActive ? 'Active' : 'Inactive',
      ]);
      break;
    }
    case 'sales_by_group': {
      const lines = await getOrderLines(filters, scope, range);
      headers = ['Group', 'NetSales_IQD', 'Units'];
      rows = M.salesByGroup(lines).map((g) => [locale === 'ar' ? g.nameAr : g.nameEn, g.netSales, g.units]);
      break;
    }
    default: {
      const matchedOrders = await getOrders(filters, scope, range);
      const orderIds = matchedOrders.map((order) => order.id);
      const fullOrders = orderIds.length
        ? await prisma.order.findMany({
            where: { id: { in: orderIds } },
            select: {
              id: true,
              orderNumber: true,
              placedAt: true,
              status: true,
              channel: true,
              governorate: true,
              grossAmount: true,
              discountAmount: true,
              refundAmount: true,
              deliveryFee: true,
              extraCharges: true,
            },
          })
        : [];
      const fullOrderById = new Map(fullOrders.map((order) => [order.id, order]));
      const orders = orderIds.flatMap((id) => {
        const order = fullOrderById.get(id);
        return order ? [order] : [];
      });
      const financeEntries = orderIds.length
        ? await prisma.financeEntry.findMany({
            where: {
              OR: [
                { orderId: { in: orderIds } },
                { settles: { is: { orderId: { in: orderIds } } } },
              ],
            },
            select: {
              id: true,
              orderId: true,
              type: true,
              amount: true,
              obligation: true,
              obligationKind: true,
              settlesId: true,
              archivedAt: true,
              reversedAt: true,
              reversalOfId: true,
              date: true,
              paymentMethod: true,
              account: { select: { name: true } },
              party: { select: { id: true, name: true, collectsOrderPayments: true } },
            },
          })
        : [];
      const entriesByOrder = groupInvoiceFinanceEntries(financeEntries);
      headers = [
        'OrderNumber',
        'OrderDate',
        'Channel',
        'City',
        'OperationalStatus',
        'PaymentStatus',
        'PaymentRoute',
        'Gross_IQD',
        'Discount_IQD',
        'Refund_IQD',
        'Delivery_IQD',
        'Extra_IQD',
        'InvoiceTotal_IQD',
        'Paid_IQD',
        'Remaining_IQD',
        'ProviderCollected_IQD',
        'ProviderCashReceived_IQD',
        'ProviderFeesOffset_IQD',
        'ProviderOutstanding_IQD',
      ];
      rows = orders.map((order) => {
        const payment = invoicePaymentSnapshot(order, entriesByOrder.get(order.id) ?? []);
        return [
          order.orderNumber,
          formatDate(order.placedAt, locale),
          enumLabel(order.channel, locale),
          enumLabel(order.governorate, locale),
          enumLabel(order.status, locale),
          payment.status,
          payment.route,
          order.grossAmount,
          order.discountAmount,
          order.refundAmount,
          order.deliveryFee,
          order.extraCharges,
          payment.total,
          payment.paid,
          payment.remaining,
          payment.providerCollected,
          payment.providerRemitted,
          payment.providerFeesOffset,
          payment.providerOutstanding,
        ];
      });
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
