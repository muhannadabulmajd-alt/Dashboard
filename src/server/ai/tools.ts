import 'server-only';
import type { AiPendingActionType, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { CurrentUser } from '@/server/auth/session';
import { normalizeAssistantText, type AiActionPreview, type AiClarification, type AiResultCard, type AiStreamEvent } from '@/lib/ai-assistant';
import { formatMoney, formatNumber, formatPercent, formatQuantity, toMinor, type AppLocale } from '@/lib/money';
import { parseBaghdadDateTime, resolveRange } from '@/lib/dates';
import { DashboardFiltersSchema } from '@/lib/filters';
import { DASHBOARD_TEMPLATES } from '@/lib/dashboard-builder';
import { salesByDimension, stockRow, topProducts } from '@/lib/metrics';
import { inferCustomerCandidate, recoverCustomerCandidate } from '@/lib/customer-candidate';
import { getInventoryItems } from '@/server/db/repositories/inventory.repo';
import { prisma } from '@/server/db/client';
import { buildBranchScope } from '@/server/filters/where-builder';
import { getProfitFacts } from '@/server/finance/facts';
import { getSpendRows, getSpendTotals } from '@/server/finance/spend';
import { getInvoiceData } from '@/server/invoice/data';
import { getListEntries, getListLabel, getOrderStatusRoleMap } from '@/server/lists/resolver';
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
  PrepareCustomerUpdateSchema,
  PrepareDashboardDraftSchema,
  PrepareInventoryAdjustmentSchema,
  PreparePartyUpdateSchema,
  PreparePaymentSchema,
  PrepareRefundSchema,
  PrepareReversalSchema,
  PrepareRoastBatchSchema,
  PrepareSpendReclassificationSchema,
  PreparePurchaseSchema,
  ProductBuyersSchema,
  SalesSummarySchema,
  SearchSchema,
} from './schemas';
import {
  ResolvedCustomerActionSchema,
  ResolvedCustomerUpdateActionSchema,
  ResolvedDashboardDraftActionSchema,
  ResolvedExpenseActionSchema,
  ResolvedInventoryAdjustmentActionSchema,
  ResolvedOrderActionSchema,
  ResolvedOrderStatusActionSchema,
  ResolvedPartyActionSchema,
  ResolvedPartyUpdateActionSchema,
  ResolvedPaymentActionSchema,
  ResolvedPurchaseActionSchema,
  ResolvedRefundActionSchema,
  ResolvedReversalActionSchema,
  ResolvedRoastBatchActionSchema,
  ResolvedSpendReclassificationActionSchema,
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

function highRiskChallenge(type: AiPendingActionType, validatedData: unknown): string | undefined {
  if (!['RECORD_REFUND', 'REVERSE_RECORD', 'RECLASSIFY_SPEND'].includes(type)) return undefined;
  if (!validatedData || typeof validatedData !== 'object') throw new Error('high_risk_challenge_missing');
  const value = validatedData as { orderNumber?: unknown; recordNumber?: unknown };
  const challenge = String(value.orderNumber ?? value.recordNumber ?? '').trim();
  if (!challenge) throw new Error('high_risk_challenge_missing');
  return challenge;
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
  const confirmationChallenge = highRiskChallenge(input.type, input.validatedData);
  const action = await createPendingAction({
    conversationId: input.context.conversationId,
    userId: input.context.user.id,
    sourceMessageId: input.context.sourceMessageId,
    type: input.type,
    risk: confirmationChallenge ? 'HIGH' : 'MEDIUM',
    confirmationChallenge,
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
  const statusRole = (await getOrderStatusRoleMap()).get(status.code) ?? 'UNKNOWN';

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

  let financeMode = input.financeMode;
  const directAutomaticPayment = financeMode === 'AUTO'
    && statusRole === 'SALE'
    && channel.code !== 'ONLINE_STORE'
    && input.fulfillmentMethod !== 'COURIER';
  const accountQuery = input.financeAccountQuery || (
    directAutomaticPayment ? context.user.defaultFinanceAccountId ?? null : null
  );
  let financeAccountId: string | null = null;
  if ((financeMode === 'PAID' || financeMode === 'PARTIAL' || directAutomaticPayment) && accountQuery) {
    const match = await matchFinanceAccount(accountQuery);
    if (match.kind === 'none') return noMatch(context.locale, 'financeAccountQuery', localized(context.locale, 'finance account', 'حساب مالي'));
    if (match.kind === 'ambiguous') return ambiguousMatch(context.locale, 'financeAccountQuery', match.candidates, (row) => `${String(row.name)} · ${String(row.currency)}`, (row) => String(row.id));
    financeAccountId = match.value.id;
  }
  let financeProviderId: string | null = null;
  if (financeMode === 'PROVIDER' && input.financeProviderQuery) {
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
  if ((financeMode === 'PAID' || financeMode === 'PARTIAL' || directAutomaticPayment) && !financeAccountId) {
    return missingResult(context.locale, [localized(context.locale, 'payment account', 'حساب الدفع')]);
  }
  if (financeMode === 'PROVIDER' && !financeProviderId) {
    return missingResult(context.locale, [localized(context.locale, 'payment provider', 'مزود الدفع')]);
  }
  if (directAutomaticPayment) financeMode = 'PAID';
  const placedAt = dateValue(input.placedAt) as Date;
  const paymentDate = dateValue(input.financePaymentDate) ?? (
    financeMode === 'PAID' || financeMode === 'PARTIAL' ? placedAt : null
  );
  const dueDate = dateValue(input.financeDueDate) ?? (
    financeMode === 'CREDIT' || financeMode === 'PARTIAL' ? placedAt : null
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
    financeMode,
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

type PartyResolution =
  | { ok: true; value: ResolvedParty | null; newParty: z.infer<typeof ResolvedPartyActionSchema> | null }
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
  createIfMissing = false,
): Promise<PartyResolution> {
  if (!query) return { ok: true, value: null, newParty: null };
  const match = await matchParty(query, type);
  if (match.kind === 'exact') return { ok: true, value: match.value, newParty: null };
  if (match.kind === 'ambiguous') {
    return {
      ok: false,
      result: ambiguousMatch(locale, field, match.candidates, (row) => `${String(row.name)} · ${String(row.type)}`, (row) => String(row.id)),
    };
  }
  if (createIfMissing) {
    return {
      ok: true,
      value: null,
      newParty: ResolvedPartyActionSchema.parse({
        name: query,
        type: type ?? 'OTHER',
      }),
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

type FinanceEntryMatch = {
  id: string;
  recordKey: string | null;
  reference: string | null;
  description: string | null;
  type: string;
  amount: number;
  currency: 'IQD' | 'USD';
  obligation: boolean;
  obligationKind: string | null;
  branchId: string | null;
  archivedAt: Date | null;
  reversedAt: Date | null;
  reversalOfId: string | null;
  ledgerLines: Array<{
    id: string;
    lineNo: number;
    itemName: string;
    spendTreatment: string;
    lineTotal: number;
    inventoryItemId: string | null;
  }>;
  settlements: Array<{ amount: number }>;
};

async function matchFinanceEntry(
  query: string,
  context: ToolContext,
  options: { obligationOnly?: boolean } = {},
): Promise<{ kind: 'exact'; value: FinanceEntryMatch } | { kind: 'ambiguous'; candidates: FinanceEntryMatch[] } | { kind: 'none'; candidates: [] }> {
  const scope = buildBranchScope(context.user);
  const rows = await prisma.financeEntry.findMany({
    where: {
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      ...(options.obligationOnly ? { obligation: true } : {}),
      OR: [
        { id: query },
        { recordKey: { contains: query, mode: 'insensitive' } },
        { reference: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      recordKey: true,
      reference: true,
      description: true,
      type: true,
      amount: true,
      currency: true,
      obligation: true,
      obligationKind: true,
      branchId: true,
      archivedAt: true,
      reversedAt: true,
      reversalOfId: true,
      ledgerLines: {
        select: {
          id: true,
          lineNo: true,
          itemName: true,
          spendTreatment: true,
          lineTotal: true,
          inventoryItemId: true,
        },
        orderBy: { lineNo: 'asc' },
      },
      settlements: {
        where: { archivedAt: null, reversedAt: null, reversalOfId: null },
        select: { amount: true },
      },
    },
    orderBy: { date: 'desc' },
    take: 12,
  });
  const normalized = normalizeAssistantText(query);
  const exact = rows.filter((row) => row.id === query
    || normalizeAssistantText(row.recordKey ?? '') === normalized
    || normalizeAssistantText(row.reference ?? '') === normalized);
  if (exact.length === 1) return { kind: 'exact', value: exact[0] };
  const candidates = exact.length > 1 ? exact : rows;
  return candidates.length ? { kind: 'ambiguous', candidates } : { kind: 'none', candidates: [] };
}

function financeEntryLabel(row: FinanceEntryMatch): string {
  return `${row.recordKey || row.reference || row.id} · ${row.type}`;
}

async function resolveFinanceAccount(
  query: string | null,
  context: ToolContext,
): Promise<{ ok: true; value: { id: string; name: string; currency: string } } | { ok: false; result: ToolExecution }> {
  const requested = query || context.user.defaultFinanceAccountId || null;
  if (!requested) {
    return {
      ok: false,
      result: missingResult(context.locale, [localized(context.locale, 'payment account', 'حساب الدفع')]),
    };
  }
  const account = await matchFinanceAccount(requested);
  if (account.kind === 'none') return { ok: false, result: noMatch(context.locale, 'accountQuery', localized(context.locale, 'finance account', 'حساب مالي')) };
  if (account.kind === 'ambiguous') {
    return {
      ok: false,
      result: ambiguousMatch(context.locale, 'accountQuery', account.candidates, (row) => `${String(row.name)} · ${String(row.currency)}`, (row) => String(row.id)),
    };
  }
  return { ok: true, value: account.value };
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
  const party = await resolveOptionalParty(input.partyQuery, context.locale, 'partyQuery', undefined, true);
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
    newParty: party.newParty,
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

  const supplier = await resolveOptionalParty(input.supplierQuery, context.locale, 'supplierQuery', 'SUPPLIER', true);
  if (!supplier.ok) return supplier.result;
  if (!supplier.value && !supplier.newParty) return noMatch(context.locale, 'supplierQuery', localized(context.locale, 'supplier', 'مورد'));
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
    supplierId: supplier.value?.id ?? null,
    newSupplier: supplier.newParty,
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
    summary: localized(context.locale, `Record ${itemName} from ${supplier.value?.name ?? supplier.newParty?.name}.`, `تسجيل ${itemName} من ${supplier.value?.name ?? supplier.newParty?.name}.`),
    fields: [
      { label: localized(context.locale, 'Item', 'المادة'), value: itemName },
      { label: localized(context.locale, 'Quantity', 'الكمية'), value: `${formatQuantity(validated.quantity, context.locale)} ${validated.unit}` },
      { label: localized(context.locale, 'Total', 'الإجمالي'), value: formatMoney(toMinor(validated.totalAmount, validated.currency), validated.currency, context.locale) },
      { label: localized(context.locale, 'Supplier', 'المورد'), value: supplier.value?.name ?? supplier.newParty?.name ?? '—' },
      ...(supplier.newParty ? [{
        label: localized(context.locale, 'Supplier setup', 'إعداد المورد'),
        value: localized(context.locale, 'Create new supplier with this purchase', 'إنشاء مورد جديد مع عملية الشراء'),
      }] : []),
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
  let completionMode = input.completionMode;
  const directAutomaticPayment = completionMode === 'AUTO'
    && status.metricRole === 'SALE'
    && matched.value.channel !== 'ONLINE_STORE'
    && matched.value.fulfillmentMethod !== 'COURIER';
  const accountQuery = input.accountQuery || (
    directAutomaticPayment ? context.user.defaultFinanceAccountId ?? null : null
  );
  let accountId: string | null = null;
  if (accountQuery) {
    const account = await matchFinanceAccount(accountQuery);
    if (account.kind === 'none') return noMatch(context.locale, 'accountQuery', localized(context.locale, 'finance account', 'حساب مالي'));
    if (account.kind === 'ambiguous') return ambiguousMatch(context.locale, 'accountQuery', account.candidates, (row) => `${String(row.name)} · ${String(row.currency)}`, (row) => String(row.id));
    accountId = account.value.id;
  }
  if ((completionMode === 'DIRECT' || directAutomaticPayment) && !accountId) return missingResult(context.locale, [localized(context.locale, 'payment account', 'حساب الدفع')]);
  if (directAutomaticPayment) completionMode = 'DIRECT';
  let providerKey: string | null = null;
  if (completionMode === 'PROVIDER') {
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
  const date = dateValue(input.date) ?? (completionMode === 'DIRECT' ? context.now : null);
  const validated = ResolvedOrderStatusActionSchema.parse({
    orderId: matched.value.id,
    orderNumber: matched.value.orderNumber,
    status: status.code,
    completionMode,
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

function changePreviewValue(before: unknown, after: unknown): string {
  const render = (value: unknown) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  };
  return `${render(before)} → ${render(after)}`;
}

async function prepareCustomerUpdate(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = PrepareCustomerUpdateSchema.parse(raw);
  const missing: string[] = [];
  if (!input.customerQuery) missing.push(localized(context.locale, 'customer', 'العميل'));
  if (!input.reason || input.reason.length < 3) missing.push(localized(context.locale, 'update reason', 'سبب التحديث'));
  if (missing.length) return missingResult(context.locale, missing);

  const matched = await matchCustomer(input.customerQuery as string);
  if (matched.kind === 'none') return noMatch(context.locale, 'customerQuery', localized(context.locale, 'customer', 'عميل'));
  if (matched.kind === 'ambiguous') {
    return ambiguousMatch(
      context.locale,
      'customerQuery',
      matched.candidates,
      (row) => `${String(row.nameEn || row.nameAr || row.externalId || row.id)} · ${String(row.phone ?? '')}`,
      (row) => String(row.externalId ?? row.id),
    );
  }
  const customer = await prisma.customer.findUnique({
    where: { id: matched.value.id },
    select: {
      id: true,
      externalId: true,
      nameEn: true,
      nameAr: true,
      phone: true,
      email: true,
      governorate: true,
      address1: true,
      street: true,
      notes: true,
      campaignSource: true,
      segment: true,
    },
  });
  if (!customer) return noMatch(context.locale, 'customerQuery', localized(context.locale, 'customer', 'عميل'));

  const changes: Record<string, unknown> = {};
  const preview: AiActionPreview['fields'] = [];
  const addChange = (key: string, labelEn: string, labelAr: string, before: unknown, after: unknown) => {
    if (after === null) return;
    changes[key] = after;
    preview.push({ label: localized(context.locale, labelEn, labelAr), value: changePreviewValue(before, after) });
  };
  addChange('nameEn', 'English name', 'الاسم بالإنجليزية', customer.nameEn, input.nameEn);
  addChange('nameAr', 'Arabic name', 'الاسم بالعربية', customer.nameAr, input.nameAr);
  addChange('phone', 'Phone', 'الهاتف', customer.phone, input.phone);
  addChange('email', 'Email', 'البريد الإلكتروني', customer.email, input.email);
  if (input.governorate !== null) {
    let governorate = input.governorate;
    if (governorate) {
      const resolved = await resolveManagedChoice('governorate', governorate, context.locale, 'governorate');
      if (!resolved.ok) return resolved.result;
      governorate = resolved.code;
    }
    addChange('governorate', 'Governorate', 'المحافظة', customer.governorate, governorate);
  }
  addChange('address1', 'Address', 'العنوان', customer.address1, input.address1);
  addChange('street', 'Street / landmark', 'الشارع / أقرب نقطة', customer.street, input.street);
  addChange('notes', 'Notes', 'الملاحظات', customer.notes, input.notes);
  addChange('campaignSource', 'Campaign source', 'مصدر الحملة', customer.campaignSource, input.campaignSource);
  addChange('segment', 'Segment', 'الشريحة', customer.segment, input.segment);
  if (!Object.keys(changes).length) {
    return missingResult(context.locale, [localized(context.locale, 'at least one customer field to change', 'حقل عميل واحد على الأقل للتعديل')]);
  }
  const validated = ResolvedCustomerUpdateActionSchema.parse({
    customerId: customer.id,
    externalId: customer.externalId,
    ...changes,
    reason: input.reason,
  });
  const label = context.locale === 'ar'
    ? customer.nameAr || customer.nameEn || customer.externalId || customer.id
    : customer.nameEn || customer.nameAr || customer.externalId || customer.id;
  return actionResult({
    context,
    type: 'UPDATE_CUSTOMER',
    extractedData: input,
    validatedData: validated,
    title: localized(context.locale, 'Update customer', 'تحديث العميل'),
    summary: localized(context.locale, `Update ${label}.`, `تحديث ${label}.`),
    fields: [
      { label: localized(context.locale, 'Customer', 'العميل'), value: label },
      ...preview,
      { label: localized(context.locale, 'Reason', 'السبب'), value: validated.reason },
    ],
  });
}

async function preparePartyUpdate(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = PreparePartyUpdateSchema.parse(raw);
  const missing: string[] = [];
  if (!input.partyQuery) missing.push(localized(context.locale, 'party', 'الجهة'));
  if (!input.reason || input.reason.length < 3) missing.push(localized(context.locale, 'update reason', 'سبب التحديث'));
  if (missing.length) return missingResult(context.locale, missing);

  const matched = await matchParty(input.partyQuery as string);
  if (matched.kind === 'none') return noMatch(context.locale, 'partyQuery', localized(context.locale, 'party', 'جهة'));
  if (matched.kind === 'ambiguous') {
    return ambiguousMatch(
      context.locale,
      'partyQuery',
      matched.candidates,
      (row) => `${String(row.name)} · ${String(row.type)} · ${String(row.phone ?? '')}`,
      (row) => String(row.id),
    );
  }
  const party = await prisma.party.findUnique({
    where: { id: matched.value.id },
    select: {
      id: true,
      name: true,
      type: true,
      phone: true,
      email: true,
      address: true,
      notes: true,
      netFeesFromRemittance: true,
      collectsOrderPayments: true,
    },
  });
  if (!party) return noMatch(context.locale, 'partyQuery', localized(context.locale, 'party', 'جهة'));

  const changes: Record<string, unknown> = {};
  const preview: AiActionPreview['fields'] = [];
  const addChange = (key: string, labelEn: string, labelAr: string, before: unknown, after: unknown) => {
    if (after === null) return;
    changes[key] = after;
    preview.push({ label: localized(context.locale, labelEn, labelAr), value: changePreviewValue(before, after) });
  };
  addChange('name', 'Name', 'الاسم', party.name, input.name);
  addChange('type', 'Type', 'النوع', party.type, input.type);
  addChange('phone', 'Phone', 'الهاتف', party.phone, input.phone);
  addChange('email', 'Email', 'البريد الإلكتروني', party.email, input.email);
  addChange('address', 'Address', 'العنوان', party.address, input.address);
  addChange('notes', 'Notes', 'الملاحظات', party.notes, input.notes);
  addChange('netFeesFromRemittance', 'Net fees from remittance', 'خصم الرسوم من التحويل', party.netFeesFromRemittance, input.netFeesFromRemittance);
  addChange('collectsOrderPayments', 'Collects order payments', 'تحصيل مدفوعات الطلبات', party.collectsOrderPayments, input.collectsOrderPayments);
  if (!Object.keys(changes).length) {
    return missingResult(context.locale, [localized(context.locale, 'at least one party field to change', 'حقل جهة واحد على الأقل للتعديل')]);
  }
  const validated = ResolvedPartyUpdateActionSchema.parse({
    partyId: party.id,
    partyName: party.name,
    ...changes,
    reason: input.reason,
  });
  return actionResult({
    context,
    type: 'UPDATE_PARTY',
    extractedData: input,
    validatedData: validated,
    title: localized(context.locale, 'Update party', 'تحديث الجهة'),
    summary: localized(context.locale, `Update ${party.name}.`, `تحديث ${party.name}.`),
    fields: [
      { label: localized(context.locale, 'Party', 'الجهة'), value: party.name },
      ...preview,
      { label: localized(context.locale, 'Reason', 'السبب'), value: validated.reason },
    ],
  });
}

async function prepareInventoryAdjustment(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = PrepareInventoryAdjustmentSchema.parse(raw);
  const missing: string[] = [];
  if (!input.inventoryItemQuery) missing.push(localized(context.locale, 'inventory item', 'مادة المخزون'));
  if (input.targetQuantity === null) missing.push(localized(context.locale, 'target quantity', 'الكمية الفعلية المستهدفة'));
  if (!input.reason || input.reason.length < 3) missing.push(localized(context.locale, 'adjustment reason', 'سبب التعديل'));
  if (input.occurredAt && !dateValue(input.occurredAt)) missing.push(localized(context.locale, 'valid adjustment date', 'تاريخ تعديل صحيح'));
  if (missing.length) return missingResult(context.locale, missing);

  const matched = await matchInventoryItem(input.inventoryItemQuery as string, buildBranchScope(context.user));
  if (matched.kind === 'none') return noMatch(context.locale, 'inventoryItemQuery', localized(context.locale, 'inventory item', 'مادة مخزون'));
  if (matched.kind === 'ambiguous') {
    return ambiguousMatch(
      context.locale,
      'inventoryItemQuery',
      matched.candidates,
      (row) => `${String(context.locale === 'ar' ? row.nameAr : row.nameEn)} · ${String(row.category)} · ${String(row.unit)}`,
      (row) => String(row.id),
    );
  }
  const current = await prisma.stockMovement.aggregate({
    where: {
      inventoryItemId: matched.value.id,
      OR: [
        { financeEntryId: null },
        { financeEntry: { archivedAt: null, reversedAt: null, reversalOfId: null } },
      ],
    },
    _sum: { quantity: true },
  });
  const currentQuantity = Number(current._sum.quantity ?? 0);
  const itemName = context.locale === 'ar' ? matched.value.nameAr : matched.value.nameEn;
  const occurredAt = dateValue(input.occurredAt) ?? context.now;
  const validated = ResolvedInventoryAdjustmentActionSchema.parse({
    inventoryItemId: matched.value.id,
    inventoryItemName: itemName,
    targetQuantity: input.targetQuantity,
    occurredAt: occurredAt.toISOString(),
    reason: input.reason,
  });
  const delta = validated.targetQuantity - currentQuantity;
  return actionResult({
    context,
    type: 'ADJUST_INVENTORY',
    extractedData: input,
    validatedData: validated,
    title: localized(context.locale, 'Adjust inventory', 'تعديل المخزون'),
    summary: localized(context.locale, `Set ${itemName} to the verified physical quantity.`, `ضبط ${itemName} على الكمية الفعلية المؤكدة.`),
    fields: [
      { label: localized(context.locale, 'Inventory item', 'مادة المخزون'), value: itemName },
      { label: localized(context.locale, 'Current quantity', 'الكمية الحالية'), value: `${formatQuantity(currentQuantity, context.locale)} ${matched.value.unit}` },
      { label: localized(context.locale, 'Target quantity', 'الكمية المستهدفة'), value: `${formatQuantity(validated.targetQuantity, context.locale)} ${matched.value.unit}` },
      { label: localized(context.locale, 'Difference', 'الفرق'), value: `${delta > 0 ? '+' : ''}${formatQuantity(delta, context.locale)} ${matched.value.unit}` },
      { label: localized(context.locale, 'Date', 'التاريخ'), value: validated.occurredAt.slice(0, 10) },
      { label: localized(context.locale, 'Reason', 'السبب'), value: validated.reason },
    ],
  });
}

async function resolveInventoryForAction(
  query: string | null,
  field: string,
  context: ToolContext,
): Promise<OptionalResolution<{ id: string; name: string; unit: string; category: string }>> {
  if (!query) return { ok: true, value: null };
  const matched = await matchInventoryItem(query, buildBranchScope(context.user));
  if (matched.kind === 'none') return { ok: false, result: noMatch(context.locale, field, localized(context.locale, 'inventory item', 'مادة مخزون')) };
  if (matched.kind === 'ambiguous') {
    return {
      ok: false,
      result: ambiguousMatch(
        context.locale,
        field,
        matched.candidates,
        (row) => `${String(context.locale === 'ar' ? row.nameAr : row.nameEn)} · ${String(row.category)} · ${String(row.unit)}`,
        (row) => String(row.id),
      ),
    };
  }
  return {
    ok: true,
    value: {
      id: matched.value.id,
      name: context.locale === 'ar' ? matched.value.nameAr : matched.value.nameEn,
      unit: matched.value.unit,
      category: matched.value.category,
    },
  };
}

async function prepareRoastBatch(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = PrepareRoastBatchSchema.parse(raw);
  const missing: string[] = [];
  if (!input.batchNumber) missing.push(localized(context.locale, 'batch number', 'رقم الدفعة'));
  if (!input.origin) missing.push(localized(context.locale, 'coffee origin', 'منشأ القهوة'));
  if (input.greenInputGrams === null) missing.push(localized(context.locale, 'green input grams', 'وزن البن الأخضر بالغرام'));
  if (input.roastDate && !dateValue(input.roastDate)) missing.push(localized(context.locale, 'valid roast date', 'تاريخ تحميص صحيح'));
  if (missing.length) return missingResult(context.locale, missing);

  const green = await resolveInventoryForAction(input.greenInventoryItemQuery, 'greenInventoryItemQuery', context);
  if (!green.ok) return green.result;
  const roasted = await resolveInventoryForAction(input.roastedInventoryItemQuery, 'roastedInventoryItemQuery', context);
  if (!roasted.ok) return roasted.result;
  const branch = await resolveOptionalBranch(input.branchQuery, context.locale);
  if (!branch.ok) return branch.result;
  const roastDate = dateValue(input.roastDate) ?? context.now;
  const validated = ResolvedRoastBatchActionSchema.parse({
    batchNumber: input.batchNumber,
    origin: input.origin,
    roastDate: roastDate.toISOString(),
    roastLevel: input.roastLevel,
    greenInputGrams: input.greenInputGrams,
    roastedOutputGrams: input.roastedOutputGrams,
    qcScore: input.qcScore,
    qcNotes: input.qcNotes,
    greenInventoryItemId: green.value?.id ?? null,
    roastedInventoryItemId: roasted.value?.id ?? null,
    branchId: branch.value?.id ?? null,
  });
  return actionResult({
    context,
    type: 'CREATE_ROAST_BATCH',
    extractedData: input,
    validatedData: validated,
    title: localized(context.locale, 'Create roast batch', 'إنشاء دفعة تحميص'),
    summary: localized(context.locale, `Create roast batch ${validated.batchNumber}.`, `إنشاء دفعة التحميص ${validated.batchNumber}.`),
    fields: [
      { label: localized(context.locale, 'Batch', 'الدفعة'), value: validated.batchNumber },
      { label: localized(context.locale, 'Origin', 'المنشأ'), value: validated.origin },
      { label: localized(context.locale, 'Roast date', 'تاريخ التحميص'), value: validated.roastDate?.slice(0, 10) ?? '—' },
      { label: localized(context.locale, 'Green input', 'مدخل البن الأخضر'), value: `${formatQuantity(validated.greenInputGrams, context.locale)} g${green.value ? ` · ${green.value.name}` : ''}` },
      ...(validated.roastedOutputGrams !== null ? [{
        label: localized(context.locale, 'Roasted output', 'الناتج المحمص'),
        value: `${formatQuantity(validated.roastedOutputGrams, context.locale)} g${roasted.value ? ` · ${roasted.value.name}` : ''}`,
      }] : []),
      ...(validated.roastLevel ? [{ label: localized(context.locale, 'Roast level', 'درجة التحميص'), value: validated.roastLevel }] : []),
      ...(branch.value ? [{ label: localized(context.locale, 'Branch', 'الفرع'), value: context.locale === 'ar' ? branch.value.nameAr : branch.value.nameEn }] : []),
    ],
  });
}

async function preparePayment(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = PreparePaymentSchema.parse(raw);
  const missing: string[] = [];
  if (!input.targetType) missing.push(localized(context.locale, 'payment target type', 'نوع السجل المطلوب دفعه'));
  if (!input.targetQuery) missing.push(localized(context.locale, 'order or finance record', 'الطلب أو السجل المالي'));
  if (input.amount === null) missing.push(localized(context.locale, 'payment amount', 'مبلغ الدفع'));
  if (input.date && !dateValue(input.date)) missing.push(localized(context.locale, 'valid payment date', 'تاريخ دفع صحيح'));
  if (missing.length) return missingResult(context.locale, missing);
  const account = await resolveFinanceAccount(input.accountQuery, context);
  if (!account.ok) return account.result;

  let targetId: string;
  let targetNumber: string;
  let currency: 'IQD' | 'USD';
  let outstanding: number;
  if (input.targetType === 'ORDER') {
    const order = await matchOrder(input.targetQuery as string, buildBranchScope(context.user));
    if (order.kind === 'none') return noMatch(context.locale, 'targetQuery', localized(context.locale, 'order', 'طلب'));
    if (order.kind === 'ambiguous') {
      return ambiguousMatch(context.locale, 'targetQuery', order.candidates, (row) => `${String(row.orderNumber)} · ${String(row.status)}`, (row) => String(row.orderNumber));
    }
    const invoice = await getInvoiceData(order.value.id);
    if (!invoice) return noMatch(context.locale, 'targetQuery', localized(context.locale, 'order', 'طلب'));
    targetId = invoice.order.id;
    targetNumber = invoice.order.orderNumber;
    currency = invoice.order.currency;
    outstanding = invoice.payment.remaining;
  } else {
    const entry = await matchFinanceEntry(input.targetQuery as string, context, { obligationOnly: true });
    if (entry.kind === 'none') return noMatch(context.locale, 'targetQuery', localized(context.locale, 'outstanding finance record', 'سجل مالي مستحق'));
    if (entry.kind === 'ambiguous') {
      return ambiguousMatch(context.locale, 'targetQuery', entry.candidates, financeEntryLabel, (row) => String(row.recordKey || row.reference || row.id));
    }
    targetId = entry.value.id;
    targetNumber = entry.value.recordKey || entry.value.reference || entry.value.id;
    currency = entry.value.currency;
    outstanding = Math.max(0, entry.value.amount - entry.value.settlements.reduce((sum, settlement) => sum + settlement.amount, 0));
  }
  const validated = ResolvedPaymentActionSchema.parse({
    targetType: input.targetType,
    targetId,
    targetNumber,
    amount: input.amount,
    accountId: account.value.id,
    accountName: account.value.name,
    paymentMethod: input.paymentMethod,
    date: (dateValue(input.date) ?? context.now).toISOString(),
  });
  return actionResult({
    context,
    type: 'RECORD_PAYMENT',
    extractedData: input,
    validatedData: validated,
    title: localized(context.locale, 'Record payment', 'تسجيل دفعة'),
    summary: localized(context.locale, `Record a payment for ${targetNumber}.`, `تسجيل دفعة للسجل ${targetNumber}.`),
    fields: [
      { label: localized(context.locale, 'Record', 'السجل'), value: targetNumber },
      { label: localized(context.locale, 'Amount', 'المبلغ'), value: formatMoney(toMinor(validated.amount, currency), currency, context.locale) },
      { label: localized(context.locale, 'Outstanding before payment', 'المتبقي قبل الدفع'), value: formatMoney(outstanding, currency, context.locale) },
      { label: localized(context.locale, 'Account', 'الحساب'), value: account.value.name },
      { label: localized(context.locale, 'Date', 'التاريخ'), value: validated.date.slice(0, 10) },
    ],
  });
}

async function prepareRefund(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = PrepareRefundSchema.parse(raw);
  const missing: string[] = [];
  if (!input.orderQuery) missing.push(localized(context.locale, 'order', 'الطلب'));
  if (input.amount === null) missing.push(localized(context.locale, 'refund amount', 'مبلغ الاسترداد'));
  if (!input.reason || input.reason.length < 3) missing.push(localized(context.locale, 'refund reason', 'سبب الاسترداد'));
  if (input.date && !dateValue(input.date)) missing.push(localized(context.locale, 'valid refund date', 'تاريخ استرداد صحيح'));
  if (missing.length) return missingResult(context.locale, missing);
  const account = await resolveFinanceAccount(input.accountQuery, context);
  if (!account.ok) return account.result;
  const order = await matchOrder(input.orderQuery as string, buildBranchScope(context.user));
  if (order.kind === 'none') return noMatch(context.locale, 'orderQuery', localized(context.locale, 'order', 'طلب'));
  if (order.kind === 'ambiguous') {
    return ambiguousMatch(context.locale, 'orderQuery', order.candidates, (row) => `${String(row.orderNumber)} · ${String(row.status)}`, (row) => String(row.orderNumber));
  }
  const invoice = await getInvoiceData(order.value.id);
  if (!invoice) return noMatch(context.locale, 'orderQuery', localized(context.locale, 'order', 'طلب'));
  const originalTotal = Math.max(
    0,
    invoice.order.grossAmount - invoice.order.discountAmount + invoice.order.deliveryFee + invoice.order.extraCharges,
  );
  const refundable = Math.min(
    invoice.payment.paidRaw,
    Math.max(0, originalTotal - invoice.order.refundAmount),
  );
  const validated = ResolvedRefundActionSchema.parse({
    orderId: invoice.order.id,
    orderNumber: invoice.order.orderNumber,
    amount: input.amount,
    accountId: account.value.id,
    accountName: account.value.name,
    paymentMethod: input.paymentMethod,
    date: (dateValue(input.date) ?? context.now).toISOString(),
    reason: input.reason,
  });
  return actionResult({
    context,
    type: 'RECORD_REFUND',
    extractedData: input,
    validatedData: validated,
    title: localized(context.locale, 'Record order refund', 'تسجيل استرداد طلب'),
    summary: localized(context.locale, `Refund ${invoice.order.orderNumber}.`, `استرداد للطلب ${invoice.order.orderNumber}.`),
    fields: [
      { label: localized(context.locale, 'Order', 'الطلب'), value: invoice.order.orderNumber },
      { label: localized(context.locale, 'Refund amount', 'مبلغ الاسترداد'), value: formatMoney(toMinor(validated.amount, invoice.order.currency), invoice.order.currency, context.locale) },
      { label: localized(context.locale, 'Refundable balance', 'الرصيد القابل للاسترداد'), value: formatMoney(refundable, invoice.order.currency, context.locale) },
      { label: localized(context.locale, 'Account', 'الحساب'), value: account.value.name },
      { label: localized(context.locale, 'Reason', 'السبب'), value: validated.reason },
      { label: localized(context.locale, 'Final confirmation', 'التأكيد النهائي'), value: invoice.order.orderNumber },
    ],
    warnings: [localized(
      context.locale,
      `A second confirmation with ${invoice.order.orderNumber} is required.`,
      `يتطلب هذا الإجراء تأكيداً ثانياً برقم ${invoice.order.orderNumber}.`,
    )],
  });
}

async function prepareReversal(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = PrepareReversalSchema.parse(raw);
  const missing: string[] = [];
  if (!input.recordQuery) missing.push(localized(context.locale, 'finance record', 'السجل المالي'));
  if (!input.reason || input.reason.length < 3) missing.push(localized(context.locale, 'reversal reason', 'سبب العكس'));
  if (missing.length) return missingResult(context.locale, missing);
  const entry = await matchFinanceEntry(input.recordQuery as string, context);
  if (entry.kind === 'none') return noMatch(context.locale, 'recordQuery', localized(context.locale, 'finance record', 'سجل مالي'));
  if (entry.kind === 'ambiguous') {
    return ambiguousMatch(context.locale, 'recordQuery', entry.candidates, financeEntryLabel, (row) => String(row.recordKey || row.reference || row.id));
  }
  const recordNumber = entry.value.recordKey || entry.value.reference || entry.value.id;
  const validated = ResolvedReversalActionSchema.parse({
    financeEntryId: entry.value.id,
    recordNumber,
    reason: input.reason,
  });
  return actionResult({
    context,
    type: 'REVERSE_RECORD',
    extractedData: input,
    validatedData: validated,
    title: localized(context.locale, 'Reverse finance record', 'عكس سجل مالي'),
    summary: localized(context.locale, `Reverse ${recordNumber}.`, `عكس السجل ${recordNumber}.`),
    fields: [
      { label: localized(context.locale, 'Record', 'السجل'), value: recordNumber },
      { label: localized(context.locale, 'Type', 'النوع'), value: entry.value.type },
      { label: localized(context.locale, 'Amount', 'المبلغ'), value: formatMoney(entry.value.amount, entry.value.currency, context.locale) },
      { label: localized(context.locale, 'Reason', 'السبب'), value: validated.reason },
      { label: localized(context.locale, 'Final confirmation', 'التأكيد النهائي'), value: recordNumber },
    ],
    warnings: [localized(
      context.locale,
      `A second confirmation with ${recordNumber} is required.`,
      `يتطلب هذا الإجراء تأكيداً ثانياً برقم ${recordNumber}.`,
    )],
  });
}

type FixedAssetMatch = { id: string; name: string; category: string };

async function resolveFixedAsset(
  query: string | null,
  context: ToolContext,
): Promise<OptionalResolution<FixedAssetMatch>> {
  if (!query) return { ok: true, value: null };
  const scope = buildBranchScope(context.user);
  const rows = await prisma.fixedAsset.findMany({
    where: {
      isActive: true,
      archivedAt: null,
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      OR: [{ id: query }, { name: { contains: query, mode: 'insensitive' } }],
    },
    select: { id: true, name: true, category: true },
    orderBy: { name: 'asc' },
    take: 8,
  });
  const normalized = normalizeAssistantText(query);
  const exact = rows.filter((row) => row.id === query || normalizeAssistantText(row.name) === normalized);
  if (exact.length === 1) return { ok: true, value: exact[0] };
  const candidates = exact.length > 1 ? exact : rows;
  if (!candidates.length) return { ok: false, result: noMatch(context.locale, 'fixedAssetQuery', localized(context.locale, 'fixed asset', 'أصل ثابت')) };
  return {
    ok: false,
    result: ambiguousMatch(context.locale, 'fixedAssetQuery', candidates, (row) => `${String(row.name)} · ${String(row.category)}`, (row) => String(row.id)),
  };
}

async function prepareSpendReclassification(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = PrepareSpendReclassificationSchema.parse(raw);
  const missing: string[] = [];
  if (!input.recordQuery) missing.push(localized(context.locale, 'finance record', 'السجل المالي'));
  if (!input.spendTreatment) missing.push(localized(context.locale, 'new spending treatment', 'معالجة الإنفاق الجديدة'));
  if (!input.classificationNote || input.classificationNote.length < 3) missing.push(localized(context.locale, 'classification reason', 'سبب التصنيف'));
  if (missing.length) return missingResult(context.locale, missing);
  const entry = await matchFinanceEntry(input.recordQuery as string, context);
  if (entry.kind === 'none') return noMatch(context.locale, 'recordQuery', localized(context.locale, 'finance record', 'سجل مالي'));
  if (entry.kind === 'ambiguous') {
    return ambiguousMatch(context.locale, 'recordQuery', entry.candidates, financeEntryLabel, (row) => String(row.recordKey || row.reference || row.id));
  }
  if (!entry.value.ledgerLines.length) {
    return noMatch(context.locale, 'lineQuery', localized(context.locale, 'spending line', 'بند إنفاق'));
  }
  let line: FinanceEntryMatch['ledgerLines'][number] | null = null;
  if (input.lineQuery) {
    const normalized = normalizeAssistantText(input.lineQuery);
    const lineMatches = entry.value.ledgerLines.filter((candidate) => candidate.id === input.lineQuery
      || String(candidate.lineNo) === input.lineQuery
      || normalizeAssistantText(candidate.itemName) === normalized);
    if (lineMatches.length === 1) line = lineMatches[0];
    else {
      const candidates = lineMatches.length ? lineMatches : entry.value.ledgerLines;
      return ambiguousMatch(
        context.locale,
        'lineQuery',
        candidates,
        (candidate) => `${String(candidate.lineNo)} · ${String(candidate.itemName)} · ${String(candidate.spendTreatment)}`,
        (candidate) => String(candidate.id),
      );
    }
  } else if (entry.value.ledgerLines.length === 1) {
    line = entry.value.ledgerLines[0];
  } else {
    return clarificationResult({
      field: 'lineQuery',
      message: localized(context.locale, 'Choose the spending line to reclassify.', 'اختر بند الإنفاق المطلوب إعادة تصنيفه.'),
      choices: matchChoices(
        entry.value.ledgerLines,
        (candidate) => `${String(candidate.lineNo)} · ${String(candidate.itemName)} · ${String(candidate.spendTreatment)}`,
        (candidate) => String(candidate.id),
      ),
    });
  }
  const asset = await resolveFixedAsset(input.fixedAssetQuery, context);
  if (!asset.ok) return asset.result;
  let inventory: OptionalResolution<{ id: string; name: string; unit: string; category: string }> = { ok: true, value: null };
  if (input.spendTreatment === 'INVENTORY') {
    if (!input.inventoryItemQuery) return missingResult(context.locale, [localized(context.locale, 'inventory item', 'مادة المخزون')]);
    inventory = await resolveInventoryForAction(input.inventoryItemQuery, 'inventoryItemQuery', context);
    if (!inventory.ok) return inventory.result;
  }
  const recordNumber = entry.value.recordKey || entry.value.reference || entry.value.id;
  const validated = ResolvedSpendReclassificationActionSchema.parse({
    entryId: entry.value.id,
    recordNumber,
    lineId: line.id,
    lineName: line.itemName,
    spendTreatment: input.spendTreatment,
    classificationNote: input.classificationNote,
    fixedAssetId: input.spendTreatment === 'CAPEX' ? asset.value?.id ?? null : null,
    inventoryItemId: input.spendTreatment === 'INVENTORY' && inventory.ok ? inventory.value?.id ?? null : null,
  });
  return actionResult({
    context,
    type: 'RECLASSIFY_SPEND',
    extractedData: input,
    validatedData: validated,
    title: localized(context.locale, 'Reclassify spending', 'إعادة تصنيف الإنفاق'),
    summary: localized(context.locale, `Reclassify ${line.itemName} in ${recordNumber}.`, `إعادة تصنيف ${line.itemName} في السجل ${recordNumber}.`),
    fields: [
      { label: localized(context.locale, 'Record', 'السجل'), value: recordNumber },
      { label: localized(context.locale, 'Line', 'البند'), value: `${line.lineNo} · ${line.itemName}` },
      { label: localized(context.locale, 'Current treatment', 'المعالجة الحالية'), value: line.spendTreatment },
      { label: localized(context.locale, 'New treatment', 'المعالجة الجديدة'), value: validated.spendTreatment },
      ...(asset.value ? [{ label: localized(context.locale, 'Fixed asset', 'الأصل الثابت'), value: asset.value.name }] : []),
      ...(inventory.ok && inventory.value ? [{ label: localized(context.locale, 'Inventory item', 'مادة المخزون'), value: inventory.value.name }] : []),
      { label: localized(context.locale, 'Reason', 'السبب'), value: validated.classificationNote },
      { label: localized(context.locale, 'Final confirmation', 'التأكيد النهائي'), value: recordNumber },
    ],
    warnings: [localized(
      context.locale,
      `A second confirmation with ${recordNumber} is required.`,
      `يتطلب هذا الإجراء تأكيداً ثانياً برقم ${recordNumber}.`,
    )],
  });
}

async function prepareDashboardDraft(raw: unknown, context: ToolContext): Promise<ToolExecution> {
  const input = PrepareDashboardDraftSchema.parse(raw);
  const missing: string[] = [];
  if (!input.name) missing.push(localized(context.locale, 'dashboard name', 'اسم اللوحة'));
  if (!input.template) missing.push(localized(context.locale, 'dashboard template', 'قالب اللوحة'));
  if (missing.length) return missingResult(context.locale, missing);
  const template = DASHBOARD_TEMPLATES.find((candidate) => candidate.key === input.template);
  if (!template) return missingResult(context.locale, [localized(context.locale, 'valid dashboard template', 'قالب لوحة صحيح')]);
  const description = input.description || (context.locale === 'ar' ? template.descriptionAr : template.descriptionEn);
  const validated = ResolvedDashboardDraftActionSchema.parse({
    name: input.name,
    description,
    config: JSON.parse(JSON.stringify(template.config)),
  });
  return actionResult({
    context,
    type: 'CREATE_DASHBOARD_DRAFT',
    extractedData: input,
    validatedData: validated,
    title: localized(context.locale, 'Create dashboard draft', 'إنشاء مسودة لوحة'),
    summary: localized(context.locale, `Create the private dashboard draft ${validated.name}.`, `إنشاء مسودة اللوحة الخاصة ${validated.name}.`),
    fields: [
      { label: localized(context.locale, 'Name', 'الاسم'), value: validated.name },
      { label: localized(context.locale, 'Template', 'القالب'), value: context.locale === 'ar' ? template.nameAr : template.nameEn },
      { label: localized(context.locale, 'Widgets', 'العناصر'), value: formatNumber(validated.config.widgets.length, context.locale) },
      { label: localized(context.locale, 'Visibility', 'الظهور'), value: localized(context.locale, 'Private draft', 'مسودة خاصة') },
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
  prepare_update_customer: prepareCustomerUpdate,
  prepare_update_party: preparePartyUpdate,
  prepare_adjust_inventory: prepareInventoryAdjustment,
  prepare_create_roast_batch: prepareRoastBatch,
  prepare_record_payment: preparePayment,
  prepare_record_refund: prepareRefund,
  prepare_reverse_finance_record: prepareReversal,
  prepare_reclassify_spend: prepareSpendReclassification,
  prepare_dashboard_draft: prepareDashboardDraft,
};

export async function executeAssistantTool(name: string, raw: unknown, context: ToolContext): Promise<ToolExecution> {
  assertAssistantToolAllowed(context.user.role, name);
  const handler = TOOL_HANDLERS[name];
  if (!handler) throw new Error('ai_tool_not_allowed');
  return handler(raw, context);
}
