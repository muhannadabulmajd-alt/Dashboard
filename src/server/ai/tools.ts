import 'server-only';
import type { AiPendingActionType, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { CurrentUser } from '@/server/auth/session';
import type { AiActionPreview, AiClarification, AiResultCard, AiStreamEvent } from '@/lib/ai-assistant';
import { formatMoney, formatNumber, formatPercent, formatQuantity, toMinor, type AppLocale } from '@/lib/money';
import { parseBaghdadDateTime, resolveRange } from '@/lib/dates';
import { DashboardFiltersSchema } from '@/lib/filters';
import { salesByDimension, stockRow, topProducts } from '@/lib/metrics';
import { inferCustomerCandidate, recoverCustomerCandidate } from '@/lib/customer-candidate';
import { getInventoryItems } from '@/server/db/repositories/inventory.repo';
import { prisma } from '@/server/db/client';
import { buildBranchScope } from '@/server/filters/where-builder';
import { getProfitFacts } from '@/server/finance/facts';
import { getSpendRows, getSpendTotals } from '@/server/finance/spend';
import { getInvoiceData } from '@/server/invoice/data';
import { getListEntries, getListLabel } from '@/server/lists/resolver';
import { getOrderOperationalDefaults } from '@/server/records/order-defaults';
import { findProductBuyers } from '@/server/customers/product-buyers';
import { createPendingAction } from './pending';
import { actionPreconditionIssues, loadActionPreconditions } from './preconditions';
import {
  matchCustomer,
  matchFinanceAccount,
  matchInventoryItem,
  matchOrder,
  matchParty,
  matchProduct,
} from './matching';
import {
  ExpenseSummarySchema,
  InventorySummarySchema,
  PrepareCustomerSchema,
  PrepareExpenseSchema,
  PrepareOrderSchema,
  PrepareOrderStatusSchema,
  PreparePurchaseSchema,
  ProductBuyersSchema,
  SalesSummarySchema,
  SearchSchema,
} from './schemas';
import {
  ResolvedCustomerActionSchema,
  ResolvedExpenseActionSchema,
  ResolvedOrderActionSchema,
  ResolvedOrderStatusActionSchema,
  ResolvedPurchaseActionSchema,
} from './action-data';
import { assertAssistantToolAllowed } from './access';

export type ToolContext = {
  conversationId: string;
  sourceMessageId: string;
  recentUserMessages: string[];
  user: CurrentUser;
  locale: AppLocale;
  now: Date;
};

export type ToolExecution = {
  modelOutput: Record<string, unknown>;
  events: AiStreamEvent[];
};

function localized(locale: AppLocale, en: string, ar: string): string {
  return locale === 'ar' ? ar : en;
}

function dateValue(value: string | null): Date | null {
  return parseBaghdadDateTime(value);
}

function rangeFrom(input: z.infer<typeof SalesSummarySchema>['range']) {
  return resolveRange({ range: input.preset, from: input.from ?? undefined, to: input.to ?? undefined });
}

function periodLabel(start: Date, end: Date, locale: AppLocale): string {
  const intl = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-IQ' : 'en-GB', {
    dateStyle: 'medium',
    timeZone: 'Asia/Baghdad',
  });
  return `${intl.format(start)} - ${intl.format(end)}`;
}

function generatedAt(now: Date): string {
  return now.toISOString();
}

function cardResult(card: AiResultCard): ToolExecution {
  return { modelOutput: { status: 'ok', card }, events: [{ type: 'result_card', card }] };
}

function clarificationResult(clarification: AiClarification): ToolExecution {
  return {
    modelOutput: { status: 'needs_clarification', clarification },
    events: [{ type: 'clarification', clarification }],
  };
}

function missingResult(locale: AppLocale, fields: string[]): ToolExecution {
  return clarificationResult({
    field: fields[0],
    message: localized(
      locale,
      `I still need: ${fields.join(', ')}.`,
      `أحتاج أيضاً إلى: ${fields.join('، ')}.`,
    ),
  });
}

function matchChoices<T extends Record<string, unknown>>(
  candidates: T[],
  label: (candidate: T) => string,
  value: (candidate: T) => string,
): NonNullable<AiClarification['choices']> {
  return candidates.slice(0, 8).map((candidate) => ({
    id: value(candidate),
    value: value(candidate),
    label: label(candidate),
  }));
}

function ambiguousMatch<T extends Record<string, unknown>>(
  locale: AppLocale,
  field: string,
  candidates: T[],
  label: (candidate: T) => string,
  value: (candidate: T) => string,
): ToolExecution {
  return clarificationResult({
    field,
    message: localized(locale, 'Please choose the matching record.', 'اختر السجل المطابق من فضلك.'),
    choices: matchChoices(candidates, label, value),
  });
}

function noMatch(locale: AppLocale, field: string, entity: string): ToolExecution {
  return clarificationResult({
    field,
    message: localized(locale, `I could not find that ${entity}.`, `لم أجد ${entity} مطابقاً.`),
  });
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function actionResult(input: {
  context: ToolContext;
  type: AiPendingActionType;
  extractedData: unknown;
  validatedData: unknown;
  title: string;
  summary: string;
  fields: AiActionPreview['fields'];
  warnings?: string[];
}): Promise<ToolExecution> {
  const preconditions = await loadActionPreconditions(input.type, input.validatedData);
  const issues = actionPreconditionIssues(input.type, input.validatedData, preconditions);
  if (issues.length) {
    const issue = issues[0];
    const messages: Record<string, [string, string]> = {
      customer_duplicate: ['A matching customer now exists. Please use the existing customer.', 'يوجد عميل مطابق الآن. استخدم العميل الموجود من فضلك.'],
      product_missing: ['A selected product is no longer available.', 'أحد المنتجات المختارة لم يعد متاحاً.'],
      product_inactive: ['A selected product is inactive.', 'أحد المنتجات المختارة غير فعال.'],
      stock_insufficient: ['There is not enough available stock for this order.', 'المخزون المتاح لا يكفي لهذا الطلب.'],
      customer_inactive: ['The selected customer is inactive.', 'العميل المختار غير فعال.'],
      account_inactive: ['The selected finance account is unavailable.', 'الحساب المالي المختار غير متاح.'],
      provider_invalid: ['The selected payment provider is unavailable or not configured.', 'مزود الدفع المختار غير متاح أو غير مهيأ.'],
      status_invalid: ['The selected status is unavailable.', 'الحالة المختارة غير متاحة.'],
      channel_invalid: ['The selected sales channel is unavailable.', 'قناة البيع المختارة غير متاحة.'],
      governorate_invalid: ['The selected governorate is unavailable.', 'المحافظة المختارة غير متاحة.'],
      fulfillment_invalid: ['The selected fulfillment method is unavailable.', 'طريقة التجهيز المختارة غير متاحة.'],
      party_inactive: ['The selected party is inactive.', 'الجهة المختارة غير فعالة.'],
      branch_inactive: ['The selected branch is inactive.', 'الفرع المختار غير فعال.'],
      inventory_item_missing: ['The selected inventory item is unavailable.', 'مادة المخزون المختارة غير متاحة.'],
      supplier_invalid: ['The selected supplier is unavailable.', 'المورد المختار غير متاح.'],
      order_missing: ['The selected order no longer exists.', 'الطلب المختار لم يعد موجوداً.'],
    };
    const copy = messages[issue.code] ?? ['Atlas could not safely prepare this action.', 'تعذر على أطلس إعداد هذا الإجراء بأمان.'];
    return clarificationResult({
      field: issue.field,
      message: localized(input.context.locale, copy[0], copy[1]),
    });
  }
  let fields = input.fields;
  if (input.type === 'CREATE_ORDER') {
    const automatic = (preconditions as Record<string, unknown>).automaticFinance as {
      mode?: string;
      providerKey?: string | null;
      account?: { externalKey?: string | null } | null;
    } | null;
    if (automatic?.mode) {
      const route = automatic.providerKey || automatic.account?.externalKey || automatic.mode;
      fields = fields.map((field) => field.label === localized(input.context.locale, 'Payment', 'الدفع')
        ? { ...field, value: `${localized(input.context.locale, 'Automatic', 'تلقائي')} · ${route}` }
        : field);
    }
  }
  if (input.type === 'UPDATE_ORDER_STATUS') {
    const automatic = (preconditions as Record<string, unknown>).automaticFinance as {
      mode?: string;
      providerKey?: string | null;
      account?: { externalKey?: string | null } | null;
    } | null;
    if (automatic?.mode) {
      const route = automatic.providerKey || automatic.account?.externalKey || automatic.mode;
      fields = fields.map((field) => field.label === localized(input.context.locale, 'Completion payment', 'دفع الإكمال')
        ? { ...field, value: `${localized(input.context.locale, 'Automatic', 'تلقائي')} · ${route}` }
        : field);
    }
  }
  const action = await createPendingAction({
    conversationId: input.context.conversationId,
    userId: input.context.user.id,
    sourceMessageId: input.context.sourceMessageId,
    type: input.type,
    extractedData: toInputJson(input.extractedData),
    validatedData: toInputJson(input.validatedData),
    preconditions,
    preview: {
      type: input.type,
      title: input.title,
      summary: input.summary,
      fields,
      warnings: input.warnings ?? [],
    },
  });
  return {
    modelOutput: {
      status: 'confirmation_required',
      actionId: action.id,
      expiresAt: action.expiresAt.toISOString(),
      preview: action.clientPreview,
    },
    events: [{ type: 'action_preview', action: action.clientPreview }],
  };
}

type ManagedChoice = { code: string; labelEn: string; labelAr: string; isActive: boolean };

async function resolveManagedChoice(
  listKey: 'channel' | 'governorate' | 'orderStatus',
  raw: string,
  locale: AppLocale,
  field: string,
): Promise<{ ok: true; code: string } | { ok: false; result: ToolExecution }> {
  const entries = (await getListEntries(listKey)).filter((row) => row.isActive) as ManagedChoice[];
  const normalized = raw.trim().toLocaleLowerCase(locale === 'ar' ? 'ar-IQ' : 'en-US');
  const matches = entries.filter((row) => [row.code, row.labelEn, row.labelAr]
    .some((value) => value.trim().toLocaleLowerCase(locale === 'ar' ? 'ar-IQ' : 'en-US') === normalized));
  if (matches.length === 1) return { ok: true, code: matches[0].code };
  return {
    ok: false,
    result: clarificationResult({
      field,
      message: localized(locale, 'Choose an available Atlas option.', 'اختر خياراً متاحاً في أطلس.'),
      choices: entries.slice(0, 20).map((row) => ({
        id: row.code,
        value: row.code,
        label: locale === 'ar' ? row.labelAr : row.labelEn,
      })),
    }),
  };
}

async function salesSummary(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = SalesSummarySchema.parse(raw);
  const range = rangeFrom(input.range);
  const filters = DashboardFiltersSchema.parse({
    range: input.range.preset,
    from: input.range.from ?? undefined,
    to: input.range.to ?? undefined,
  });
  const scope = buildBranchScope(context.user);
  const facts = await getProfitFacts(filters, scope, range);
  let rows: AiResultCard['rows'] = [];
  if (input.dimension === 'CHANNEL' || input.dimension === 'CITY') {
    const key = input.dimension === 'CHANNEL' ? 'channel' : 'governorate';
    rows = salesByDimension(facts.orders, key).slice(0, 10).map((row) => ({
      id: row.key,
      title: row.key,
      subtitle: localized(context.locale, `${row.orders} orders`, `${formatNumber(row.orders, 'ar')} طلب`),
      value: formatMoney(row.netSales, 'IQD', context.locale),
      href: `/sales?${key === 'channel' ? 'channel' : 'governorate'}=${encodeURIComponent(row.key)}`,
    }));
  } else if (input.dimension === 'PRODUCT') {
    rows = topProducts(facts.lines, 10).map((row) => ({
      id: row.productId,
      title: context.locale === 'ar' ? row.name.ar : row.name.en,
      subtitle: `${row.sku} · ${formatNumber(row.units, context.locale)} ${localized(context.locale, 'units', 'وحدة')}`,
      value: formatMoney(row.netSales, 'IQD', context.locale),
      href: `/sales?sku=${encodeURIComponent(row.sku)}`,
    }));
  }
  return cardResult({
    title: localized(context.locale, 'Sales summary', 'ملخص المبيعات'),
    answer: localized(
      context.locale,
      `${formatMoney(facts.pnl.netSales, 'IQD', context.locale)} earned from ${formatNumber(facts.saleOrderCount, context.locale)} completed sale orders.`,
      `بلغت المبيعات المكتسبة ${formatMoney(facts.pnl.netSales, 'IQD', context.locale)} من ${formatNumber(facts.saleOrderCount, context.locale)} طلب بيع مكتمل.`,
    ),
    period: periodLabel(range.start, range.end, context.locale),
    generatedAt: generatedAt(context.now),
    metrics: [
      { label: localized(context.locale, 'Net sales', 'صافي المبيعات'), value: formatMoney(facts.pnl.netSales, 'IQD', context.locale) },
      { label: localized(context.locale, 'Orders', 'الطلبات'), value: formatNumber(facts.saleOrderCount, context.locale) },
      { label: localized(context.locale, 'Average order value', 'متوسط قيمة الطلب'), value: formatMoney(facts.averageOrderValue, 'IQD', context.locale) },
      { label: localized(context.locale, 'COGS', 'تكلفة البضاعة المباعة'), value: formatMoney(facts.pnl.cogs, 'IQD', context.locale) },
      { label: localized(context.locale, 'Gross margin', 'هامش الربح الإجمالي'), value: formatPercent(facts.pnl.grossMarginPct, context.locale) },
      { label: localized(context.locale, 'Operating profit', 'الربح التشغيلي'), value: formatMoney(facts.pnl.operatingProfit, 'IQD', context.locale) },
    ],
    rows,
    href: '/sales',
  });
}

async function productBuyers(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = ProductBuyersSchema.parse(raw);
  const range = rangeFrom(input.range);
  const filters = DashboardFiltersSchema.parse({
    range: input.range.preset,
    from: input.range.from ?? undefined,
    to: input.range.to ?? undefined,
  });
  const result = await findProductBuyers({
    productQuery: input.productQuery,
    filters,
    scope: buildBranchScope(context.user),
    range,
  });
  if (result.kind === 'none') {
    return noMatch(context.locale, 'productQuery', localized(context.locale, 'product', 'منتج'));
  }
  if (result.kind === 'ambiguous') {
    return ambiguousMatch(
      context.locale,
      'productQuery',
      result.candidates,
      (row) => `${String(context.locale === 'ar' ? row.nameAr || row.nameEn : row.nameEn || row.nameAr)} · ${String(row.sizeLabel)} · ${String(row.sku)}`,
      (row) => String(row.sku),
    );
  }

  const productName = context.locale === 'ar'
    ? result.product.nameAr || result.product.nameEn
    : result.product.nameEn || result.product.nameAr;
  const params = new URLSearchParams({
    product: result.product.sku,
    range: input.range.preset,
  });
  if (input.range.from) params.set('from', input.range.from);
  if (input.range.to) params.set('to', input.range.to);
  const guestHint = result.guestOrderCount
    ? localized(
        context.locale,
        ` ${formatNumber(result.guestOrderCount, context.locale)} additional matching order(s) have no linked customer.`,
        ` ويوجد ${formatNumber(result.guestOrderCount, context.locale)} طلب مطابق إضافي بلا عميل مرتبط.`,
      )
    : '';

  return cardResult({
    title: localized(context.locale, `Customers who bought ${productName}`, `العملاء الذين اشتروا ${productName}`),
    answer: localized(
      context.locale,
      `${formatNumber(result.buyers.length, context.locale)} linked customers bought this item in ${formatNumber(result.orderCount, context.locale)} completed sale orders.${guestHint}`,
      `اشترى هذا المنتج ${formatNumber(result.buyers.length, context.locale)} عميل مرتبط ضمن ${formatNumber(result.orderCount, context.locale)} طلب بيع مكتمل.${guestHint}`,
    ),
    period: periodLabel(range.start, range.end, context.locale),
    generatedAt: generatedAt(context.now),
    metrics: [
      { label: localized(context.locale, 'Unique buyers', 'العملاء المشترون'), value: formatNumber(result.buyers.length, context.locale) },
      { label: localized(context.locale, 'Orders', 'الطلبات'), value: formatNumber(result.orderCount, context.locale) },
      { label: localized(context.locale, 'Units', 'الوحدات'), value: formatNumber(result.units, context.locale) },
      { label: localized(context.locale, 'Product sales', 'مبيعات المنتج'), value: formatMoney(result.itemSales, 'IQD', context.locale) },
    ],
    rows: result.buyers.slice(0, input.limit).map((buyer) => ({
      id: buyer.customerId,
      title: (context.locale === 'ar' ? buyer.nameAr : buyer.nameEn) || buyer.nameEn || buyer.nameAr || buyer.externalId || localized(context.locale, 'Unnamed customer', 'عميل بلا اسم'),
      subtitle: [
        buyer.phone,
        buyer.externalId,
        localized(context.locale, `${buyer.orders} order(s) · ${buyer.units} unit(s)`, `${formatNumber(buyer.orders, 'ar')} طلب · ${formatNumber(buyer.units, 'ar')} وحدة`),
      ].filter(Boolean).join(' · '),
      value: formatMoney(buyer.itemSales, 'IQD', context.locale),
      href: `/admin/records/customers/${buyer.customerId}`,
    })),
    href: `/customers/product-buyers?${params.toString()}`,
  });
}

async function searchOrders(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = SearchSchema.parse(raw);
  const normalizedPhone = input.query.replace(/\D/g, '');
  const scope = buildBranchScope(context.user);
  const rows = await prisma.order.findMany({
    where: {
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      OR: [
        { orderNumber: { contains: input.query, mode: 'insensitive' } },
        { customer: { externalId: { contains: input.query, mode: 'insensitive' } } },
        { customer: { nameEn: { contains: input.query, mode: 'insensitive' } } },
        { customer: { nameAr: { contains: input.query, mode: 'insensitive' } } },
        {
          lines: {
            some: {
              OR: [
                { sku: { contains: input.query, mode: 'insensitive' } },
                { product: { sku: { contains: input.query, mode: 'insensitive' } } },
                { product: { barcodeValue: { contains: input.query, mode: 'insensitive' } } },
                { product: { retailBarcode: { contains: input.query, mode: 'insensitive' } } },
                { product: { nameEn: { contains: input.query, mode: 'insensitive' } } },
                { product: { nameAr: { contains: input.query, mode: 'insensitive' } } },
                { product: { group: { nameEn: { contains: input.query, mode: 'insensitive' } } } },
                { product: { group: { nameAr: { contains: input.query, mode: 'insensitive' } } } },
              ],
            },
          },
        },
        ...(normalizedPhone.length >= 7
          ? [{ customer: { phone: { contains: normalizedPhone.slice(-7), mode: 'insensitive' as const } } }]
          : []),
      ],
    },
    select: {
      id: true,
      orderNumber: true,
      placedAt: true,
      status: true,
      grossAmount: true,
      discountAmount: true,
      refundAmount: true,
      deliveryFee: true,
      extraCharges: true,
      customer: { select: { nameEn: true, nameAr: true, externalId: true } },
    },
    orderBy: { placedAt: 'desc' },
    take: input.limit,
  });
  const resultRows = rows.map((row) => ({
    id: row.id,
    title: row.orderNumber,
    subtitle: `${row.customer?.nameEn || row.customer?.nameAr || localized(context.locale, 'No customer', 'بدون عميل')} · ${row.status}`,
    value: formatMoney(Math.max(0, row.grossAmount - row.discountAmount - row.refundAmount + row.deliveryFee + row.extraCharges), 'IQD', context.locale),
    href: `/admin/records/orders/${row.id}`,
  }));
  return cardResult({
    title: localized(context.locale, 'Order search', 'البحث في الطلبات'),
    answer: localized(context.locale, `Found ${rows.length} matching orders.`, `تم العثور على ${formatNumber(rows.length, 'ar')} طلب مطابق.`),
    generatedAt: generatedAt(context.now),
    rows: resultRows,
    href: `/admin/records/orders?q=${encodeURIComponent(input.query)}`,
  });
}

async function orderDetails(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = z.object({ query: z.string().trim().min(1) }).strict().parse(raw);
  const matched = await matchOrder(input.query, buildBranchScope(context.user));
  if (matched.kind === 'none') return noMatch(context.locale, 'orderQuery', localized(context.locale, 'order', 'طلب'));
  if (matched.kind === 'ambiguous') {
    return ambiguousMatch(
      context.locale,
      'orderQuery',
      matched.candidates,
      (row) => `${String(row.orderNumber)} · ${String(row.status)}`,
      (row) => String(row.orderNumber),
    );
  }
  const data = await getInvoiceData(matched.value.id);
  if (!data) return noMatch(context.locale, 'orderQuery', localized(context.locale, 'order', 'طلب'));
  const customer = data.order.customer?.nameEn || data.order.customer?.nameAr || localized(context.locale, 'No customer', 'بدون عميل');
  return cardResult({
    title: data.order.orderNumber,
    answer: localized(
      context.locale,
      `${customer}. ${data.payment.status} with ${formatMoney(data.payment.remaining, data.order.currency, context.locale)} remaining.`,
      `${customer}. حالة الدفع ${data.payment.status} والمتبقي ${formatMoney(data.payment.remaining, data.order.currency, context.locale)}.`,
    ),
    period: new Intl.DateTimeFormat(context.locale === 'ar' ? 'ar-IQ' : 'en-GB', { dateStyle: 'medium', timeZone: 'Asia/Baghdad' }).format(data.order.placedAt),
    generatedAt: generatedAt(context.now),
    metrics: [
      { label: localized(context.locale, 'Order status', 'حالة الطلب'), value: data.order.status },
      { label: localized(context.locale, 'Invoice total', 'إجمالي الفاتورة'), value: formatMoney(data.payment.total, data.order.currency, context.locale) },
      { label: localized(context.locale, 'Paid', 'المدفوع'), value: formatMoney(data.payment.paid, data.order.currency, context.locale) },
      { label: localized(context.locale, 'Remaining', 'المتبقي'), value: formatMoney(data.payment.remaining, data.order.currency, context.locale) },
    ],
    rows: data.order.lines.map((line) => ({
      id: line.id,
      title: context.locale === 'ar' ? line.product.nameAr : line.product.nameEn,
      subtitle: `${line.sku} · ${formatNumber(line.quantity, context.locale)} ${line.unitLabel}`,
      value: formatMoney(line.lineNet, data.order.currency, context.locale),
    })),
    href: `/admin/records/orders/${data.order.id}`,
  });
}

async function inventorySummary(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = InventorySummarySchema.parse(raw);
  const filters = DashboardFiltersSchema.parse({ range: 'all' });
  const range = resolveRange({ range: 'all' });
  const items = await getInventoryItems(filters, buildBranchScope(context.user), range);
  const query = input.query?.trim().toLocaleLowerCase('ar-IQ') ?? null;
  const rows = items
    .map(stockRow)
    .filter((row) => !query || [row.item.nameEn, row.item.nameAr, row.item.category].some((value) => value.toLocaleLowerCase('ar-IQ').includes(query)))
    .filter((row) => !input.lowStockOnly || row.belowReorder)
    .sort((a, b) => Number(b.belowReorder) - Number(a.belowReorder) || a.current - b.current)
    .slice(0, input.limit);
  const allRows = items.map(stockRow);
  const inventoryValue = Math.round(allRows.reduce((sum, row) => sum + row.value, 0));
  return cardResult({
    title: localized(context.locale, 'Inventory summary', 'ملخص المخزون'),
    answer: localized(
      context.locale,
      `${formatNumber(allRows.length, context.locale)} items with a FIFO value of ${formatMoney(inventoryValue, 'IQD', context.locale)}.`,
      `${formatNumber(allRows.length, context.locale)} مادة بقيمة FIFO تبلغ ${formatMoney(inventoryValue, 'IQD', context.locale)}.`,
    ),
    generatedAt: generatedAt(context.now),
    metrics: [
      { label: localized(context.locale, 'Inventory value', 'قيمة المخزون'), value: formatMoney(inventoryValue, 'IQD', context.locale) },
      { label: localized(context.locale, 'Items', 'المواد'), value: formatNumber(allRows.length, context.locale) },
      { label: localized(context.locale, 'Low stock', 'مخزون منخفض'), value: formatNumber(allRows.filter((row) => row.belowReorder).length, context.locale) },
    ],
    rows: rows.map((row) => ({
      id: row.item.id,
      title: context.locale === 'ar' ? row.item.nameAr : row.item.nameEn,
      subtitle: `${row.item.category}${row.belowReorder ? ` · ${localized(context.locale, 'Low stock', 'مخزون منخفض')}` : ''}`,
      value: `${formatQuantity(row.current, context.locale)} ${row.item.unit}`,
      href: `/admin/records/inventory/${row.item.id}`,
    })),
    href: '/inventory',
  });
}

async function expenseSummary(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = ExpenseSummarySchema.parse(raw);
  const range = rangeFrom(input.range);
  const filters = DashboardFiltersSchema.parse({
    range: input.range.preset,
    from: input.range.from ?? undefined,
    to: input.range.to ?? undefined,
  });
  const scope = buildBranchScope(context.user);
  const bucket = input.bucket === 'all' ? 'all' : input.bucket;
  const [rows, totals] = await Promise.all([
    getSpendRows(bucket, filters, scope, range, input.category ? { category: input.category } : {}),
    getSpendTotals(filters, scope, range),
  ]);
  const shownTotal = rows.reduce((sum, row) => sum + row.amount, 0);
  return cardResult({
    title: localized(context.locale, 'Spending summary', 'ملخص الإنفاق'),
    answer: localized(
      context.locale,
      `${formatMoney(shownTotal, 'IQD', context.locale)} across ${formatNumber(rows.length, context.locale)} records in the selected view.`,
      `${formatMoney(shownTotal, 'IQD', context.locale)} عبر ${formatNumber(rows.length, context.locale)} سجل في العرض المحدد.`,
    ),
    period: periodLabel(range.start, range.end, context.locale),
    generatedAt: generatedAt(context.now),
    metrics: [
      { label: localized(context.locale, 'Total recorded spending', 'إجمالي الإنفاق المسجل'), value: formatMoney(totals.totalSpent, 'IQD', context.locale) },
      { label: 'Capex', value: formatMoney(totals.capex, 'IQD', context.locale) },
      { label: localized(context.locale, 'Inventory purchased', 'مشتريات المخزون'), value: formatMoney(totals.inventory, 'IQD', context.locale) },
      { label: 'Opex', value: formatMoney(totals.opex, 'IQD', context.locale) },
      { label: localized(context.locale, 'Needs review', 'يحتاج مراجعة'), value: formatMoney(totals.review, 'IQD', context.locale) },
      { label: 'COGS', value: formatMoney(totals.cogs, 'IQD', context.locale), hint: localized(context.locale, 'Not added again to spending', 'لا تضاف مرة أخرى إلى الإنفاق') },
    ],
    rows: rows.slice(0, 12).map((row) => ({
      id: row.id,
      title: row.description,
      subtitle: [row.category, row.party, row.reference].filter(Boolean).join(' · '),
      value: formatMoney(row.amount, 'IQD', context.locale),
      href: row.sourceHref ?? undefined,
    })),
    href: `/finance/spend?bucket=${encodeURIComponent(bucket)}`,
  });
}

async function searchCustomers(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = SearchSchema.parse(raw);
  const matched = await matchCustomer(input.query);
  const rows = matched.kind === 'exact' ? [matched.value] : matched.candidates.slice(0, input.limit);
  return cardResult({
    title: localized(context.locale, 'Customer search', 'البحث عن العملاء'),
    answer: localized(context.locale, `Found ${rows.length} matching customers.`, `تم العثور على ${formatNumber(rows.length, 'ar')} عميل مطابق.`),
    generatedAt: generatedAt(context.now),
    rows: rows.map((row) => ({
      id: row.id,
      title: row.nameEn || row.nameAr || row.phone || row.externalId || localized(context.locale, 'Customer', 'عميل'),
      subtitle: [row.externalId, row.phone].filter(Boolean).join(' · '),
      href: `/admin/records/customers/${row.id}`,
    })),
    href: `/admin/records/customers?q=${encodeURIComponent(input.query)}`,
  });
}

async function prepareCustomer(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = PrepareCustomerSchema.parse(raw);
  const missing = !input.nameEn && !input.nameAr && !input.phone ? [localized(context.locale, 'customer name or phone', 'اسم العميل أو رقم الهاتف')] : [];
  if (missing.length) return missingResult(context.locale, missing);
  if (input.phone) {
    const match = await matchCustomer(input.phone);
    if (match.kind === 'exact') {
      return clarificationResult({
        field: 'phone',
        message: localized(
          context.locale,
          `This phone already belongs to ${match.value.nameEn || match.value.nameAr || match.value.externalId}. Use the existing customer instead?`,
          `هذا الرقم مرتبط مسبقاً بالعميل ${match.value.nameAr || match.value.nameEn || match.value.externalId}. هل تريد استخدام العميل الموجود؟`,
        ),
        choices: [{ id: match.value.id, value: match.value.externalId ?? match.value.id, label: match.value.nameEn || match.value.nameAr || match.value.externalId || 'Customer' }],
      });
    }
    if (match.kind === 'ambiguous') {
      return ambiguousMatch(
        context.locale,
        'phone',
        match.candidates,
        (row) => `${String(row.nameEn || row.nameAr || row.externalId)} · ${String(row.phone ?? '')}`,
        (row) => String(row.externalId ?? row.id),
      );
    }
  }
  const validated = ResolvedCustomerActionSchema.parse(Object.fromEntries(
    Object.entries({ ...input, segment: input.segment ?? 'NEW' }).map(([key, value]) => [key, value ?? undefined]),
  ));
  const name = validated.nameEn || validated.nameAr || validated.phone || 'Customer';
  return actionResult({
    context,
    type: 'CREATE_CUSTOMER',
    extractedData: input,
    validatedData: validated,
    title: localized(context.locale, 'Create customer', 'إنشاء عميل'),
    summary: localized(context.locale, `Create ${name} as a new customer.`, `إنشاء ${name} كعميل جديد.`),
    fields: [
      { label: localized(context.locale, 'Name', 'الاسم'), value: name },
      { label: localized(context.locale, 'Phone', 'الهاتف'), value: validated.phone || '—' },
      { label: localized(context.locale, 'Governorate', 'المحافظة'), value: validated.governorate || '—' },
      { label: localized(context.locale, 'Segment', 'الشريحة'), value: validated.segment },
    ],
  });
}

async function prepareOrder(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const supplied = PrepareOrderSchema.parse(raw);
  const defaults = await getOrderOperationalDefaults(context.now);
  const input = {
    ...supplied,
    placedAt: supplied.placedAt || defaults.placedAt,
    channel: supplied.channel || defaults.channel,
    governorate: supplied.governorate || defaults.governorate,
    fulfillmentMethod: supplied.fulfillmentMethod || defaults.fulfillmentMethod,
    status: supplied.status || defaults.status,
    financeMode: supplied.financeMode || defaults.financeMode,
  };
  const missing: string[] = [];
  if (!dateValue(input.placedAt)) missing.push(localized(context.locale, 'valid order date', 'تاريخ طلب صحيح'));
  if (missing.length) return missingResult(context.locale, missing);

  const [channel, governorate, status] = await Promise.all([
    resolveManagedChoice('channel', input.channel, context.locale, 'channel'),
    resolveManagedChoice('governorate', input.governorate, context.locale, 'governorate'),
    resolveManagedChoice('orderStatus', input.status, context.locale, 'status'),
  ]);
  if (!channel.ok) return channel.result;
  if (!governorate.ok) return governorate.result;
  if (!status.ok) return status.result;

  let customerExternalId: string | null = null;
  let customerLabel = localized(context.locale, 'Walk-in / no customer', 'بيع مباشر / بدون عميل');
  let inferredNewCustomer: z.infer<typeof ResolvedCustomerActionSchema> | null = null;
  if (input.customerQuery) {
    const match = await matchCustomer(input.customerQuery);
    if (match.kind === 'none') {
      const inferred = recoverCustomerCandidate(
        inferCustomerCandidate(input.customerQuery),
        context.recentUserMessages,
      );
      if (!input.newCustomer && !inferred) {
        return noMatch(context.locale, 'customerQuery', localized(context.locale, 'customer', 'عميل'));
      }
      inferredNewCustomer = inferred
        ? ResolvedCustomerActionSchema.parse({ ...inferred, governorate: governorate.code })
        : null;
    }
    if (match.kind === 'ambiguous') {
      return ambiguousMatch(
        context.locale,
        'customerQuery',
        match.candidates,
        (row) => `${String(row.nameEn || row.nameAr || row.externalId)} · ${String(row.phone ?? '')}`,
        (row) => String(row.externalId ?? row.id),
      );
    }
    if (match.kind === 'exact') {
      customerExternalId = match.value.externalId;
      customerLabel = context.locale === 'ar'
        ? match.value.nameAr || match.value.nameEn || match.value.externalId || customerLabel
        : match.value.nameEn || match.value.nameAr || match.value.externalId || customerLabel;
      if (!customerExternalId) return noMatch(context.locale, 'customerQuery', localized(context.locale, 'customer ID', 'رقم العميل'));
    }
  }

  let newCustomer: z.infer<typeof ResolvedCustomerActionSchema> | null = null;
  const recoveredExplicitCustomer = input.newCustomer
    ? recoverCustomerCandidate({
          nameEn: input.newCustomer.nameEn ?? undefined,
          nameAr: input.newCustomer.nameAr ?? undefined,
          phone: input.newCustomer.phone ?? undefined,
          address1: input.newCustomer.address1 ?? undefined,
        }, context.recentUserMessages)
    : null;
  const explicitNewCustomer = input.newCustomer
    ? {
        ...input.newCustomer,
        nameEn: input.newCustomer.nameEn ?? recoveredExplicitCustomer?.nameEn,
        nameAr: input.newCustomer.nameAr ?? recoveredExplicitCustomer?.nameAr,
        phone: input.newCustomer.phone ?? recoveredExplicitCustomer?.phone,
        address1: input.newCustomer.address1 ?? recoveredExplicitCustomer?.address1,
      }
    : null;
  const newCustomerInput = customerExternalId ? null : explicitNewCustomer ?? inferredNewCustomer;
  if (newCustomerInput) {
    const parsed = ResolvedCustomerActionSchema.safeParse(Object.fromEntries(
      Object.entries({ ...newCustomerInput, segment: newCustomerInput.segment ?? 'NEW' }).map(([key, value]) => [key, value ?? undefined]),
    ));
    if (!parsed.success || (!parsed.data.nameEn && !parsed.data.nameAr && !parsed.data.phone)) {
      return missingResult(context.locale, [localized(context.locale, 'new customer name or phone', 'اسم العميل الجديد أو الهاتف')]);
    }
    newCustomer = parsed.data;
    customerLabel = context.locale === 'ar'
      ? newCustomer.nameAr || newCustomer.nameEn || newCustomer.phone || customerLabel
      : newCustomer.nameEn || newCustomer.nameAr || newCustomer.phone || customerLabel;
    if (newCustomer.phone) {
      const existing = await matchCustomer(newCustomer.phone);
      if (existing.kind === 'exact') {
        if (!existing.value.externalId) {
          return noMatch(context.locale, 'newCustomer.phone', localized(context.locale, 'customer ID', 'رقم العميل'));
        }
        customerExternalId = existing.value.externalId;
        customerLabel = context.locale === 'ar'
          ? existing.value.nameAr || existing.value.nameEn || existing.value.externalId
          : existing.value.nameEn || existing.value.nameAr || existing.value.externalId;
        newCustomer = null;
      }
      if (existing.kind === 'ambiguous') {
        return ambiguousMatch(
          context.locale,
          'newCustomer.phone',
          existing.candidates,
          (row) => `${String(row.nameEn || row.nameAr || row.externalId)} · ${String(row.phone ?? '')}`,
          (row) => String(row.externalId ?? row.id),
        );
      }
    }
  }

  const resolvedLines: z.infer<typeof ResolvedOrderActionSchema>['lines'] = [];
  const previewLines: string[] = [];
  for (let index = 0; index < input.lines.length; index += 1) {
    const line = input.lines[index];
    const match = await matchProduct(line.productQuery);
    if (match.kind === 'none') return noMatch(context.locale, `lines.${index}.productQuery`, localized(context.locale, 'product', 'منتج'));
    if (match.kind === 'ambiguous') {
      return ambiguousMatch(
        context.locale,
        `lines.${index}.productQuery`,
        match.candidates,
        (row) => `${String(context.locale === 'ar' ? row.nameAr || row.nameEn : row.nameEn || row.nameAr)} · ${String(row.sizeLabel)} · ${String(row.sku)} · ${formatMoney(Number(row.sellingPrice), 'IQD', context.locale)}`,
        (row) => String(row.sku),
      );
    }
    const price = line.unitGrossPrice ?? match.value.sellingPrice;
    if (price == null || price < 0) return missingResult(context.locale, [localized(context.locale, `price for ${match.value.sku}`, `سعر ${match.value.sku}`)]);
    resolvedLines.push({
      productId: match.value.id,
      sku: match.value.sku,
      quantity: line.quantity,
      unitGrossPrice: price,
      lineDiscount: line.lineDiscount,
    });
    previewLines.push(`${line.quantity} x ${context.locale === 'ar' ? match.value.nameAr : match.value.nameEn} · ${match.value.sizeLabel} · ${match.value.sku}`);
  }

  let financeAccountId: string | null = null;
  if ((input.financeMode === 'PAID' || input.financeMode === 'PARTIAL') && input.financeAccountQuery) {
    const match = await matchFinanceAccount(input.financeAccountQuery);
    if (match.kind === 'none') return noMatch(context.locale, 'financeAccountQuery', localized(context.locale, 'finance account', 'حساب مالي'));
    if (match.kind === 'ambiguous') return ambiguousMatch(context.locale, 'financeAccountQuery', match.candidates, (row) => `${String(row.name)} · ${String(row.currency)}`, (row) => String(row.id));
    financeAccountId = match.value.id;
  }
  if ((input.financeMode === 'PAID' || input.financeMode === 'PARTIAL') && !financeAccountId) {
    financeAccountId = (
      await prisma.financeAccount.findFirst({
        where: {
          externalKey: 'CASH_ON_HANDS',
          isActive: true,
          currency: 'IQD',
        },
        select: { id: true },
      })
    )?.id ?? null;
  }
  let financeProviderId: string | null = null;
  if (input.financeMode === 'PROVIDER' && input.financeProviderQuery) {
    const match = await matchParty(input.financeProviderQuery);
    if (match.kind === 'none') return noMatch(context.locale, 'financeProviderQuery', localized(context.locale, 'payment provider', 'مزود الدفع'));
    if (match.kind === 'ambiguous') return ambiguousMatch(context.locale, 'financeProviderQuery', match.candidates, (row) => `${String(row.name)} · ${String(row.type)}`, (row) => String(row.id));
    if (!match.value.collectsOrderPayments || !match.value.defaultSettlementAccountId) {
      return clarificationResult({
        field: 'financeProviderQuery',
        message: localized(context.locale, 'That party is not configured to collect order payments.', 'هذه الجهة غير مهيأة لتحصيل مدفوعات الطلبات.'),
      });
    }
    financeProviderId = match.value.id;
  }
  if ((input.financeMode === 'PAID' || input.financeMode === 'PARTIAL') && !financeAccountId) {
    return missingResult(context.locale, [localized(context.locale, 'payment account', 'حساب الدفع')]);
  }
  if (input.financeMode === 'PROVIDER' && !financeProviderId) {
    return missingResult(context.locale, [localized(context.locale, 'payment provider', 'مزود الدفع')]);
  }
  const placedAt = dateValue(input.placedAt) as Date;
  const paymentDate = dateValue(input.financePaymentDate) ?? (
    input.financeMode === 'PAID' || input.financeMode === 'PARTIAL' ? placedAt : null
  );
  const dueDate = dateValue(input.financeDueDate) ?? (
    input.financeMode === 'CREDIT' || input.financeMode === 'PARTIAL' ? placedAt : null
  );
  const validated = ResolvedOrderActionSchema.parse({
    customerExternalId,
    newCustomer,
    placedAt: placedAt.toISOString(),
    channel: channel.code,
    governorate: governorate.code,
    fulfillmentMethod: input.fulfillmentMethod,
    status: status.code,
    deliveryFee: input.deliveryFee,
    deliveryCost: input.deliveryCost,
    orderDiscount: input.orderDiscount,
    extraCharges: input.extraCharges,
    notes: input.notes,
    financeMode: input.financeMode,
    financeAccountId,
    financeProviderId,
    financePaidAmount: input.financePaidAmount,
    financePaymentMethod: input.financePaymentMethod,
    financePaymentDate: paymentDate?.toISOString() ?? null,
    financeDueDate: dueDate?.toISOString() ?? null,
    lines: resolvedLines,
  });
  const subtotal = resolvedLines.reduce((sum, line) => sum + line.unitGrossPrice * line.quantity - line.lineDiscount, 0);
  const total = Math.max(0, subtotal - validated.orderDiscount + validated.deliveryFee + validated.extraCharges);
  const [channelLabel, governorateLabel, fulfillmentLabel, statusLabel] = await Promise.all([
    getListLabel('channel', validated.channel, context.locale),
    getListLabel('governorate', validated.governorate, context.locale),
    getListLabel('fulfillment', validated.fulfillmentMethod, context.locale),
    getListLabel('orderStatus', validated.status, context.locale),
  ]);
  return actionResult({
    context,
    type: 'CREATE_ORDER',
    extractedData: supplied,
    validatedData: validated,
    title: localized(context.locale, 'Create order', 'إنشاء طلب'),
    summary: localized(context.locale, `Create an order for ${formatMoney(total, 'IQD', context.locale)}.`, `إنشاء طلب بقيمة ${formatMoney(total, 'IQD', context.locale)}.`),
    fields: [
      { label: localized(context.locale, 'Customer', 'العميل'), value: customerLabel },
      ...(newCustomer ? [{
        label: localized(context.locale, 'Customer setup', 'إعداد العميل'),
        value: localized(context.locale, 'Create new customer with this order', 'إنشاء عميل جديد مع هذا الطلب'),
      }, {
        label: localized(context.locale, 'Customer name', 'اسم العميل'),
        value: newCustomer.nameAr || newCustomer.nameEn || '—',
      }, {
        label: localized(context.locale, 'Customer phone', 'هاتف العميل'),
        value: newCustomer.phone || '—',
      }, ...(newCustomer.address1 ? [{
        label: localized(context.locale, 'Customer address', 'عنوان العميل'),
        value: newCustomer.address1,
      }] : [])] : []),
      { label: localized(context.locale, 'Items', 'المواد'), value: previewLines.join(', ') },
      { label: localized(context.locale, 'Date', 'التاريخ'), value: input.placedAt },
      { label: localized(context.locale, 'Channel', 'القناة'), value: channelLabel },
      { label: localized(context.locale, 'Governorate', 'المحافظة'), value: governorateLabel },
      { label: localized(context.locale, 'Fulfillment', 'التجهيز'), value: fulfillmentLabel },
      { label: localized(context.locale, 'Status', 'الحالة'), value: statusLabel },
      { label: localized(context.locale, 'Payment', 'الدفع'), value: validated.financeMode },
      { label: localized(context.locale, 'Total', 'الإجمالي'), value: formatMoney(total, 'IQD', context.locale) },
    ],
  });
}

type OptionalResolution<T> =
  | { ok: true; value: T | null }
  | { ok: false; result: ToolExecution };

type ResolvedParty = {
  id: string;
  name: string;
  type: string;
  externalKey: string | null;
  phone: string | null;
  collectsOrderPayments: boolean;
  defaultSettlementAccountId: string | null;
};

type ResolvedBranch = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
};

async function resolveOptionalParty(
  query: string | null,
  locale: AppLocale,
  field: string,
  type?: 'SUPPLIER' | 'CUSTOMER',
): Promise<OptionalResolution<ResolvedParty>> {
  if (!query) return { ok: true, value: null };
  const match = await matchParty(query, type);
  if (match.kind === 'exact') return { ok: true, value: match.value };
  if (match.kind === 'ambiguous') {
    return {
      ok: false,
      result: ambiguousMatch(locale, field, match.candidates, (row) => `${String(row.name)} · ${String(row.type)}`, (row) => String(row.id)),
    };
  }
  return { ok: false, result: noMatch(locale, field, localized(locale, 'party', 'جهة')) };
}

async function resolveOptionalBranch(
  query: string | null,
  locale: AppLocale,
): Promise<OptionalResolution<ResolvedBranch>> {
  if (!query) return { ok: true, value: null };
  const rows = await prisma.branch.findMany({
    where: { isActive: true, OR: [{ id: query }, { code: { equals: query, mode: 'insensitive' } }, { nameEn: { contains: query, mode: 'insensitive' } }, { nameAr: { contains: query, mode: 'insensitive' } }] },
    select: { id: true, code: true, nameEn: true, nameAr: true },
    take: 8,
  });
  if (rows.length === 1) return { ok: true, value: rows[0] };
  if (rows.length > 1) {
    return {
      ok: false,
      result: ambiguousMatch(locale, 'branchQuery', rows, (row) => `${String(row.nameEn)} / ${String(row.nameAr)}`, (row) => String(row.id)),
    };
  }
  return { ok: false, result: noMatch(locale, 'branchQuery', localized(locale, 'branch', 'فرع')) };
}

async function prepareExpense(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = PrepareExpenseSchema.parse(raw);
  const missing: string[] = [];
  if (!dateValue(input.date)) missing.push(localized(context.locale, 'valid date', 'تاريخ صحيح'));
  if (!input.amount) missing.push(localized(context.locale, 'amount', 'المبلغ'));
  if (!input.currency) missing.push(localized(context.locale, 'currency', 'العملة'));
  if (input.currency === 'USD' && !input.rate) missing.push(localized(context.locale, 'USD conversion rate', 'سعر تحويل الدولار'));
  if (!input.accountQuery) missing.push(localized(context.locale, 'payment account', 'حساب الدفع'));
  if (!input.categoryType) missing.push(localized(context.locale, 'spending category', 'فئة الإنفاق'));
  if (!input.description) missing.push(localized(context.locale, 'description', 'الوصف'));
  if (missing.length) return missingResult(context.locale, missing);
  const accountMatch = await matchFinanceAccount(input.accountQuery as string);
  if (accountMatch.kind === 'none') return noMatch(context.locale, 'accountQuery', localized(context.locale, 'finance account', 'حساب مالي'));
  if (accountMatch.kind === 'ambiguous') return ambiguousMatch(context.locale, 'accountQuery', accountMatch.candidates, (row) => `${String(row.name)} · ${String(row.currency)}`, (row) => String(row.id));
  const party = await resolveOptionalParty(input.partyQuery, context.locale, 'partyQuery');
  if (!party.ok) return party.result;
  const branch = await resolveOptionalBranch(input.branchQuery, context.locale);
  if (!branch.ok) return branch.result;
  const validated = ResolvedExpenseActionSchema.parse({
    date: (dateValue(input.date) as Date).toISOString(),
    amount: input.amount,
    currency: input.currency,
    rate: input.rate,
    accountId: accountMatch.value.id,
    categoryType: input.categoryType,
    partyId: party.value?.id ?? null,
    description: input.description,
    reference: input.reference,
    branchId: branch.value?.id ?? null,
  });
  return actionResult({
    context,
    type: 'CREATE_EXPENSE',
    extractedData: input,
    validatedData: validated,
    title: localized(context.locale, 'Record expense', 'تسجيل مصروف'),
    summary: localized(context.locale, `Record ${validated.description}.`, `تسجيل ${validated.description}.`),
    fields: [
      { label: localized(context.locale, 'Amount', 'المبلغ'), value: formatMoney(toMinor(validated.amount, validated.currency), validated.currency, context.locale) },
      { label: localized(context.locale, 'Category', 'الفئة'), value: validated.categoryType },
      { label: localized(context.locale, 'Account', 'الحساب'), value: accountMatch.value.name },
      { label: localized(context.locale, 'Date', 'التاريخ'), value: validated.date.slice(0, 10) },
    ],
  });
}

async function preparePurchase(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = PreparePurchaseSchema.parse(raw);
  const missing: string[] = [];
  if (!input.purchaseType) missing.push(localized(context.locale, 'purchase type', 'نوع الشراء'));
  if (!dateValue(input.date)) missing.push(localized(context.locale, 'valid purchase date', 'تاريخ شراء صحيح'));
  if (!input.totalAmount) missing.push(localized(context.locale, 'total amount', 'المبلغ الإجمالي'));
  if (!input.currency) missing.push(localized(context.locale, 'currency', 'العملة'));
  if (input.currency === 'USD' && !input.rate) missing.push(localized(context.locale, 'USD conversion rate', 'سعر تحويل الدولار'));
  if (!input.quantity) missing.push(localized(context.locale, 'quantity', 'الكمية'));
  if (!input.unit) missing.push(localized(context.locale, 'measurement unit', 'وحدة القياس'));
  if (!input.supplierQuery) missing.push(localized(context.locale, 'supplier', 'المورد'));
  if (!input.paidMode) missing.push(localized(context.locale, 'payment state', 'حالة الدفع'));
  if (input.purchaseType === 'INVENTORY' && !input.inventoryItemQuery && !input.newItemNameEn) missing.push(localized(context.locale, 'inventory item or new item name', 'مادة المخزون أو اسم مادة جديدة'));
  if (input.purchaseType === 'INVENTORY' && !input.inventoryItemQuery && !input.newItemCategory) missing.push(localized(context.locale, 'new inventory category', 'فئة مادة المخزون الجديدة'));
  if (input.purchaseType === 'ASSET' && !input.assetName) missing.push(localized(context.locale, 'asset name', 'اسم الأصل'));
  if (input.purchaseType === 'ASSET' && !input.assetCategory) missing.push(localized(context.locale, 'asset category', 'فئة الأصل'));
  if ((input.paidMode === 'PAID' || input.paidMode === 'PARTIAL') && !input.accountQuery) missing.push(localized(context.locale, 'payment account', 'حساب الدفع'));
  if (input.paidMode === 'PARTIAL' && !input.paidAmount) missing.push(localized(context.locale, 'paid amount', 'المبلغ المدفوع'));
  if (missing.length) return missingResult(context.locale, missing);

  const supplier = await resolveOptionalParty(input.supplierQuery, context.locale, 'supplierQuery', 'SUPPLIER');
  if (!supplier.ok) return supplier.result;
  if (!supplier.value) return noMatch(context.locale, 'supplierQuery', localized(context.locale, 'supplier', 'مورد'));
  let inventoryItemId: string | null = null;
  if (input.inventoryItemQuery) {
    const item = await matchInventoryItem(input.inventoryItemQuery);
    if (item.kind === 'none') return noMatch(context.locale, 'inventoryItemQuery', localized(context.locale, 'inventory item', 'مادة مخزون'));
    if (item.kind === 'ambiguous') return ambiguousMatch(context.locale, 'inventoryItemQuery', item.candidates, (row) => `${String(row.nameEn)} / ${String(row.nameAr)} · ${String(row.unit)}`, (row) => String(row.id));
    inventoryItemId = item.value.id;
  }
  let accountId: string | null = null;
  let accountName = '—';
  if (input.accountQuery) {
    const account = await matchFinanceAccount(input.accountQuery);
    if (account.kind === 'none') return noMatch(context.locale, 'accountQuery', localized(context.locale, 'finance account', 'حساب مالي'));
    if (account.kind === 'ambiguous') return ambiguousMatch(context.locale, 'accountQuery', account.candidates, (row) => `${String(row.name)} · ${String(row.currency)}`, (row) => String(row.id));
    accountId = account.value.id;
    accountName = account.value.name;
  }
  const branch = await resolveOptionalBranch(input.branchQuery, context.locale);
  if (!branch.ok) return branch.result;
  const validated = ResolvedPurchaseActionSchema.parse({
    purchaseType: input.purchaseType,
    date: (dateValue(input.date) as Date).toISOString(),
    totalAmount: input.totalAmount,
    currency: input.currency,
    rate: input.rate,
    quantity: input.quantity,
    unit: input.unit,
    inventoryItemId,
    newItemNameEn: input.newItemNameEn,
    newItemNameAr: input.newItemNameAr,
    newItemCategory: input.newItemCategory,
    assetName: input.assetName,
    assetCategory: input.assetCategory,
    supplierId: supplier.value.id,
    paidMode: input.paidMode,
    paidAmount: input.paidAmount,
    accountId,
    paymentMethod: input.paymentMethod,
    paymentDate: dateValue(input.paymentDate)?.toISOString() ?? null,
    dueDate: dateValue(input.dueDate)?.toISOString() ?? null,
    branchId: branch.value?.id ?? null,
    reference: input.reference,
    notes: input.notes,
  });
  const itemName = validated.purchaseType === 'ASSET'
    ? validated.assetName as string
    : input.inventoryItemQuery || validated.newItemNameEn || validated.newItemNameAr || 'Inventory';
  return actionResult({
    context,
    type: 'CREATE_PURCHASE',
    extractedData: input,
    validatedData: validated,
    title: localized(context.locale, validated.purchaseType === 'ASSET' ? 'Record asset purchase' : 'Record inventory purchase', validated.purchaseType === 'ASSET' ? 'تسجيل شراء أصل' : 'تسجيل شراء مخزون'),
    summary: localized(context.locale, `Record ${itemName} from ${supplier.value.name}.`, `تسجيل ${itemName} من ${supplier.value.name}.`),
    fields: [
      { label: localized(context.locale, 'Item', 'المادة'), value: itemName },
      { label: localized(context.locale, 'Quantity', 'الكمية'), value: `${formatQuantity(validated.quantity, context.locale)} ${validated.unit}` },
      { label: localized(context.locale, 'Total', 'الإجمالي'), value: formatMoney(toMinor(validated.totalAmount, validated.currency), validated.currency, context.locale) },
      { label: localized(context.locale, 'Supplier', 'المورد'), value: supplier.value.name },
      { label: localized(context.locale, 'Payment', 'الدفع'), value: `${validated.paidMode}${validated.accountId ? ` · ${accountName}` : ''}` },
    ],
  });
}

async function prepareOrderStatus(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = PrepareOrderStatusSchema.parse(raw);
  const missing: string[] = [];
  if (!input.orderQuery) missing.push(localized(context.locale, 'order number', 'رقم الطلب'));
  if (!input.status) missing.push(localized(context.locale, 'new order status', 'حالة الطلب الجديدة'));
  if (!input.completionMode) missing.push(localized(context.locale, 'payment route for completion', 'طريقة تحصيل الدفع عند الإكمال'));
  if (missing.length) return missingResult(context.locale, missing);
  const matched = await matchOrder(input.orderQuery as string, buildBranchScope(context.user));
  if (matched.kind === 'none') return noMatch(context.locale, 'orderQuery', localized(context.locale, 'order', 'طلب'));
  if (matched.kind === 'ambiguous') return ambiguousMatch(context.locale, 'orderQuery', matched.candidates, (row) => `${String(row.orderNumber)} · ${String(row.status)}`, (row) => String(row.orderNumber));
  const statuses = (await getListEntries('orderStatus')).filter((row) => row.isActive);
  const statusValue = input.status as string;
  const status = statuses.find((row) => row.code.toLocaleLowerCase() === statusValue.toLocaleLowerCase() || row.labelEn.toLocaleLowerCase() === statusValue.toLocaleLowerCase() || row.labelAr === statusValue);
  if (!status) {
    return clarificationResult({
      field: 'status',
      message: localized(context.locale, 'Choose a valid order status.', 'اختر حالة طلب صحيحة.'),
      choices: statuses.map((row) => ({ id: row.code, value: row.code, label: context.locale === 'ar' ? row.labelAr : row.labelEn })),
    });
  }
  let accountId: string | null = null;
  if (input.accountQuery) {
    const account = await matchFinanceAccount(input.accountQuery);
    if (account.kind === 'none') return noMatch(context.locale, 'accountQuery', localized(context.locale, 'finance account', 'حساب مالي'));
    if (account.kind === 'ambiguous') return ambiguousMatch(context.locale, 'accountQuery', account.candidates, (row) => `${String(row.name)} · ${String(row.currency)}`, (row) => String(row.id));
    accountId = account.value.id;
  }
  if (input.completionMode === 'DIRECT' && !accountId) return missingResult(context.locale, [localized(context.locale, 'payment account', 'حساب الدفع')]);
  let providerKey: string | null = null;
  if (input.completionMode === 'PROVIDER') {
    if (!input.providerKey) return missingResult(context.locale, [localized(context.locale, 'payment provider', 'مزود الدفع')]);
    const provider = await matchParty(input.providerKey);
    if (provider.kind === 'none') return noMatch(context.locale, 'providerKey', localized(context.locale, 'payment provider', 'مزود دفع'));
    if (provider.kind === 'ambiguous') {
      return ambiguousMatch(context.locale, 'providerKey', provider.candidates, (row) => String(row.name), (row) => String(row.externalKey ?? row.id));
    }
    if (!provider.value.collectsOrderPayments || !provider.value.externalKey) {
      return clarificationResult({
        field: 'providerKey',
        message: localized(context.locale, 'That party is not configured to collect order payments.', 'هذه الجهة غير مهيأة لتحصيل مدفوعات الطلبات.'),
      });
    }
    providerKey = provider.value.externalKey;
  }
  const date = dateValue(input.date);
  if (input.completionMode === 'DIRECT' && !date) return missingResult(context.locale, [localized(context.locale, 'payment date', 'تاريخ الدفع')]);
  const validated = ResolvedOrderStatusActionSchema.parse({
    orderId: matched.value.id,
    orderNumber: matched.value.orderNumber,
    status: status.code,
    completionMode: input.completionMode,
    accountId,
    providerKey,
    paymentMethod: input.paymentMethod,
    date: date?.toISOString() ?? null,
  });
  return actionResult({
    context,
    type: 'UPDATE_ORDER_STATUS',
    extractedData: input,
    validatedData: validated,
    title: localized(context.locale, 'Update order status', 'تحديث حالة الطلب'),
    summary: localized(context.locale, `Change ${validated.orderNumber} from ${matched.value.status} to ${validated.status}.`, `تغيير ${validated.orderNumber} من ${matched.value.status} إلى ${validated.status}.`),
    fields: [
      { label: localized(context.locale, 'Order', 'الطلب'), value: validated.orderNumber },
      { label: localized(context.locale, 'Current status', 'الحالة الحالية'), value: matched.value.status },
      { label: localized(context.locale, 'New status', 'الحالة الجديدة'), value: validated.status },
      { label: localized(context.locale, 'Completion payment', 'دفع الإكمال'), value: validated.completionMode },
    ],
  });
}

const TOOL_HANDLERS: Record<string, (raw: unknown, context: ToolContext) => Promise<ToolExecution>> = {
  sales_summary: salesSummary,
  product_buyers: productBuyers,
  search_orders: searchOrders,
  order_details: orderDetails,
  inventory_summary: inventorySummary,
  expense_summary: expenseSummary,
  search_customers: searchCustomers,
  prepare_create_customer: prepareCustomer,
  prepare_create_order: prepareOrder,
  prepare_create_expense: prepareExpense,
  prepare_create_purchase: preparePurchase,
  prepare_update_order_status: prepareOrderStatus,
};

export async function executeAssistantTool(name: string, raw: unknown, context: ToolContext): Promise<ToolExecution> {
  assertAssistantToolAllowed(context.user.role, name);
  const handler = TOOL_HANDLERS[name];
  if (!handler) throw new Error('ai_tool_not_allowed');
  return handler(raw, context);
}
