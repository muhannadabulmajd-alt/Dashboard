import { z } from 'zod';

export const WIDGET_TYPES = ['kpi', 'line', 'bar', 'stackedBar', 'combo', 'donut', 'table', 'text', 'section'] as const;
export type DashboardWidgetType = (typeof WIDGET_TYPES)[number];

export const DATA_SOURCES = ['sales', 'finance', 'inventory', 'customers', 'fulfillment', 'roastery'] as const;
export type DashboardDataSource = (typeof DATA_SOURCES)[number];

export type WidgetValueKind = 'iqd' | 'count' | 'percent' | 'days' | 'grams';

export interface MetricDefinition {
  id: string;
  source: DashboardDataSource;
  labelEn: string;
  labelAr: string;
  supportedTypes: DashboardWidgetType[];
  valueKind: WidgetValueKind;
  defaultType: DashboardWidgetType;
  requiresDimension?: boolean;
  dimensionEn?: string;
  dimensionAr?: string;
}

export const METRIC_CATALOG: MetricDefinition[] = [
  { id: 'sales.netSales', source: 'sales', labelEn: 'Net sales', labelAr: 'صافي المبيعات', supportedTypes: ['kpi', 'line'], valueKind: 'iqd', defaultType: 'kpi' },
  { id: 'sales.orders', source: 'sales', labelEn: 'Orders', labelAr: 'الطلبات', supportedTypes: ['kpi', 'line'], valueKind: 'count', defaultType: 'kpi' },
  { id: 'sales.aov', source: 'sales', labelEn: 'Average order value', labelAr: 'متوسط قيمة الطلب', supportedTypes: ['kpi'], valueKind: 'iqd', defaultType: 'kpi' },
  { id: 'sales.avgOrdersPerDay', source: 'sales', labelEn: 'Avg orders / day', labelAr: 'متوسط الطلبات يومياً', supportedTypes: ['kpi'], valueKind: 'count', defaultType: 'kpi' },
  { id: 'sales.units', source: 'sales', labelEn: 'Units sold', labelAr: 'الوحدات المباعة', supportedTypes: ['kpi', 'bar'], valueKind: 'count', defaultType: 'kpi' },
  { id: 'sales.discount', source: 'sales', labelEn: 'Discount spend', labelAr: 'قيمة الخصومات', supportedTypes: ['kpi'], valueKind: 'iqd', defaultType: 'kpi' },
  { id: 'sales.trend', source: 'sales', labelEn: 'Sales over time', labelAr: 'المبيعات عبر الوقت', supportedTypes: ['line', 'combo'], valueKind: 'iqd', defaultType: 'line', dimensionEn: 'Date', dimensionAr: 'التاريخ' },
  { id: 'sales.byChannel', source: 'sales', labelEn: 'Sales by channel', labelAr: 'المبيعات حسب القناة', supportedTypes: ['bar', 'donut'], valueKind: 'iqd', defaultType: 'bar', dimensionEn: 'Channel', dimensionAr: 'القناة' },
  { id: 'sales.byCity', source: 'sales', labelEn: 'Sales by city', labelAr: 'المبيعات حسب المدينة', supportedTypes: ['bar', 'donut'], valueKind: 'iqd', defaultType: 'bar', dimensionEn: 'City', dimensionAr: 'المدينة' },
  { id: 'sales.byProduct', source: 'sales', labelEn: 'Sales by product', labelAr: 'المبيعات حسب المنتج', supportedTypes: ['bar', 'donut', 'table'], valueKind: 'iqd', defaultType: 'bar', dimensionEn: 'Product', dimensionAr: 'المنتج' },
  { id: 'sales.byGroup', source: 'sales', labelEn: 'Sales by product group', labelAr: 'المبيعات حسب مجموعة المنتج', supportedTypes: ['bar', 'donut'], valueKind: 'iqd', defaultType: 'bar', dimensionEn: 'Product group', dimensionAr: 'مجموعة المنتج' },

  { id: 'finance.revenue', source: 'finance', labelEn: 'Revenue', labelAr: 'الإيراد', supportedTypes: ['kpi'], valueKind: 'iqd', defaultType: 'kpi' },
  { id: 'finance.capex', source: 'finance', labelEn: 'Capex', labelAr: 'المصاريف الرأسمالية', supportedTypes: ['kpi', 'bar', 'table'], valueKind: 'iqd', defaultType: 'kpi' },
  { id: 'finance.opex', source: 'finance', labelEn: 'Opex', labelAr: 'المصاريف التشغيلية', supportedTypes: ['kpi', 'bar', 'table'], valueKind: 'iqd', defaultType: 'kpi' },
  { id: 'finance.cogs', source: 'finance', labelEn: 'COGS', labelAr: 'تكلفة البضاعة المباعة', supportedTypes: ['kpi', 'bar', 'table'], valueKind: 'iqd', defaultType: 'kpi' },
  { id: 'finance.cash', source: 'finance', labelEn: 'Cash available', labelAr: 'النقد المتاح', supportedTypes: ['kpi'], valueKind: 'iqd', defaultType: 'kpi' },
  { id: 'finance.receivables', source: 'finance', labelEn: 'Receivables', labelAr: 'مستحقات لنا', supportedTypes: ['kpi'], valueKind: 'iqd', defaultType: 'kpi' },
  { id: 'finance.payables', source: 'finance', labelEn: 'Payables', labelAr: 'مستحقات علينا', supportedTypes: ['kpi'], valueKind: 'iqd', defaultType: 'kpi' },
  { id: 'finance.spendByMonth', source: 'finance', labelEn: 'Spend by month', labelAr: 'الصرف حسب الشهر', supportedTypes: ['bar', 'line'], valueKind: 'iqd', defaultType: 'bar', dimensionEn: 'Month', dimensionAr: 'الشهر' },
  { id: 'finance.spendByCategory', source: 'finance', labelEn: 'Spend by category', labelAr: 'الصرف حسب التصنيف', supportedTypes: ['bar', 'donut'], valueKind: 'iqd', defaultType: 'donut', dimensionEn: 'Category', dimensionAr: 'التصنيف' },
  { id: 'finance.spendByParty', source: 'finance', labelEn: 'Spend by party', labelAr: 'الصرف حسب الجهة', supportedTypes: ['bar', 'table'], valueKind: 'iqd', defaultType: 'bar', dimensionEn: 'Party', dimensionAr: 'الجهة' },

  { id: 'inventory.value', source: 'inventory', labelEn: 'Inventory value', labelAr: 'قيمة المخزون', supportedTypes: ['kpi'], valueKind: 'iqd', defaultType: 'kpi' },
  { id: 'inventory.stock', source: 'inventory', labelEn: 'Available stock', labelAr: 'المخزون المتاح', supportedTypes: ['kpi', 'table'], valueKind: 'count', defaultType: 'kpi' },
  { id: 'inventory.lowStock', source: 'inventory', labelEn: 'Low stock items', labelAr: 'مواد منخفضة المخزون', supportedTypes: ['kpi', 'table'], valueKind: 'count', defaultType: 'kpi' },
  { id: 'inventory.byCategory', source: 'inventory', labelEn: 'Inventory by category', labelAr: 'المخزون حسب التصنيف', supportedTypes: ['bar', 'donut'], valueKind: 'iqd', defaultType: 'donut', dimensionEn: 'Category', dimensionAr: 'التصنيف' },

  { id: 'customers.total', source: 'customers', labelEn: 'Customers', labelAr: 'العملاء', supportedTypes: ['kpi'], valueKind: 'count', defaultType: 'kpi' },
  { id: 'customers.repeat', source: 'customers', labelEn: 'Repeat customers', labelAr: 'العملاء المتكررون', supportedTypes: ['kpi'], valueKind: 'count', defaultType: 'kpi' },
  { id: 'customers.byCity', source: 'customers', labelEn: 'Customers by city', labelAr: 'العملاء حسب المدينة', supportedTypes: ['bar', 'donut'], valueKind: 'count', defaultType: 'bar', dimensionEn: 'City', dimensionAr: 'المدينة' },
  { id: 'customers.top', source: 'customers', labelEn: 'Top customers', labelAr: 'أفضل العملاء', supportedTypes: ['table'], valueKind: 'iqd', defaultType: 'table' },

  { id: 'fulfillment.delivered', source: 'fulfillment', labelEn: 'Delivered orders', labelAr: 'طلبات تم توصيلها', supportedTypes: ['kpi'], valueKind: 'count', defaultType: 'kpi' },
  { id: 'fulfillment.open', source: 'fulfillment', labelEn: 'Open deliveries', labelAr: 'توصيلات مفتوحة', supportedTypes: ['kpi', 'table'], valueKind: 'count', defaultType: 'kpi' },
  { id: 'fulfillment.completionRate', source: 'fulfillment', labelEn: 'Delivery completion rate', labelAr: 'نسبة اكتمال التوصيل', supportedTypes: ['kpi'], valueKind: 'percent', defaultType: 'kpi' },
  { id: 'fulfillment.byStatus', source: 'fulfillment', labelEn: 'Deliveries by status', labelAr: 'التوصيل حسب الحالة', supportedTypes: ['bar', 'donut'], valueKind: 'count', defaultType: 'donut', dimensionEn: 'Status', dimensionAr: 'الحالة' },
  { id: 'fulfillment.byCourier', source: 'fulfillment', labelEn: 'Courier performance', labelAr: 'أداء شركات التوصيل', supportedTypes: ['bar', 'table'], valueKind: 'count', defaultType: 'bar', dimensionEn: 'Courier', dimensionAr: 'شركة التوصيل' },

  { id: 'roastery.batches', source: 'roastery', labelEn: 'Roast batches', labelAr: 'دفعات التحميص', supportedTypes: ['kpi', 'table'], valueKind: 'count', defaultType: 'kpi' },
  { id: 'roastery.greenInput', source: 'roastery', labelEn: 'Green input', labelAr: 'البن الأخضر الداخل', supportedTypes: ['kpi'], valueKind: 'grams', defaultType: 'kpi' },
  { id: 'roastery.roastedOutput', source: 'roastery', labelEn: 'Roasted output', labelAr: 'الناتج المحمص', supportedTypes: ['kpi'], valueKind: 'grams', defaultType: 'kpi' },
  { id: 'roastery.yield', source: 'roastery', labelEn: 'Roast yield', labelAr: 'نسبة ناتج التحميص', supportedTypes: ['kpi'], valueKind: 'percent', defaultType: 'kpi' },
  { id: 'roastery.batchHistory', source: 'roastery', labelEn: 'Batch history', labelAr: 'سجل الدفعات', supportedTypes: ['table'], valueKind: 'count', defaultType: 'table' },
];

export const MetricIdSchema = z.enum(METRIC_CATALOG.map((metric) => metric.id) as [string, ...string[]]);
export type DashboardMetricId = z.infer<typeof MetricIdSchema>;

export const LayoutSchema = z.object({
  i: z.string(),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(12),
});

export const WidgetSchema = z.object({
  id: z.string(),
  type: z.enum(WIDGET_TYPES),
  title: z.string().min(1),
  description: z.string().optional(),
  source: z.enum(DATA_SOURCES).optional(),
  metric: MetricIdSchema.optional(),
  dimension: z.string().optional(),
  filters: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
  style: z.object({
    tone: z.enum(['default', 'accent', 'success', 'warning', 'danger']).optional(),
    showLegend: z.boolean().optional(),
    showValues: z.boolean().optional(),
    compact: z.boolean().optional(),
  }).optional(),
  locked: z.boolean().optional(),
  refreshNonce: z.number().optional(),
  hideFromPdf: z.boolean().default(false),
  text: z.string().optional(),
});

export const DashboardConfigSchema = z.object({
  version: z.literal(1),
  grid: z.object({
    cols: z.literal(12),
    rowHeight: z.number().int().min(48).max(180).default(96),
    gap: z.number().int().min(8).max(32).default(16),
  }),
  globalFilters: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
  widgets: z.array(WidgetSchema),
  layout: z.array(LayoutSchema),
});

export type DashboardWidget = z.infer<typeof WidgetSchema>;
export type DashboardLayoutItem = z.infer<typeof LayoutSchema>;
export type DashboardConfig = z.infer<typeof DashboardConfigSchema>;

export type WidgetData =
  | { kind: 'kpi'; value: number; valueKind: WidgetValueKind; subtitle?: string }
  | { kind: 'series'; valueKind: WidgetValueKind; points: { label: string; value: number }[] }
  | { kind: 'table'; columns: string[]; rows: (string | number)[][] }
  | { kind: 'text'; body: string }
  | { kind: 'empty'; message: string };

export function metricById(metricId: string | undefined): MetricDefinition | undefined {
  return METRIC_CATALOG.find((metric) => metric.id === metricId);
}

function widget(
  id: string,
  type: DashboardWidgetType,
  title: string,
  metric?: DashboardMetricId,
  extra: Partial<DashboardWidget> = {},
): DashboardWidget {
  const definition = metricById(metric);
  return {
    id,
    type,
    title,
    source: definition?.source,
    metric,
    hideFromPdf: false,
    ...extra,
  };
}

export function createDashboardConfig(widgets: DashboardWidget[], layout: DashboardLayoutItem[]): DashboardConfig {
  return {
    version: 1,
    grid: { cols: 12, rowHeight: 96, gap: 16 },
    globalFilters: {},
    widgets,
    layout,
  };
}

export const DASHBOARD_TEMPLATES = [
  {
    key: 'owner-overview',
    nameEn: 'Owner Overview',
    nameAr: 'نظرة المالك',
    descriptionEn: 'Sales, cash, spending, inventory, and delivery in one view.',
    descriptionAr: 'المبيعات والنقد والصرف والمخزون والتوصيل في لوحة واحدة.',
    config: createDashboardConfig(
      [
        widget('w-sales', 'kpi', 'Net sales', 'sales.netSales'),
        widget('w-orders', 'kpi', 'Orders', 'sales.orders'),
        widget('w-cash', 'kpi', 'Cash available', 'finance.cash'),
        widget('w-inventory', 'kpi', 'Inventory value', 'inventory.value'),
        widget('w-trend', 'line', 'Sales over time', 'sales.trend'),
        widget('w-spend', 'donut', 'Spend by category', 'finance.spendByCategory'),
        widget('w-products', 'bar', 'Top products', 'sales.byProduct'),
        widget('w-delivery', 'bar', 'Deliveries by status', 'fulfillment.byStatus'),
      ],
      [
        { i: 'w-sales', x: 0, y: 0, w: 3, h: 2 },
        { i: 'w-orders', x: 3, y: 0, w: 3, h: 2 },
        { i: 'w-cash', x: 6, y: 0, w: 3, h: 2 },
        { i: 'w-inventory', x: 9, y: 0, w: 3, h: 2 },
        { i: 'w-trend', x: 0, y: 2, w: 7, h: 4 },
        { i: 'w-spend', x: 7, y: 2, w: 5, h: 4 },
        { i: 'w-products', x: 0, y: 6, w: 6, h: 4 },
        { i: 'w-delivery', x: 6, y: 6, w: 6, h: 4 },
      ],
    ),
  },
  {
    key: 'sales-dashboard',
    nameEn: 'Sales Dashboard',
    nameAr: 'لوحة المبيعات',
    descriptionEn: 'Daily sales, products, channels, and order behavior.',
    descriptionAr: 'المبيعات اليومية والمنتجات والقنوات وسلوك الطلبات.',
    config: createDashboardConfig(
      [
        widget('w-sales', 'kpi', 'Net sales', 'sales.netSales'),
        widget('w-aov', 'kpi', 'Average order value', 'sales.aov'),
        widget('w-avg-day', 'kpi', 'Avg orders / day', 'sales.avgOrdersPerDay'),
        widget('w-units', 'kpi', 'Units sold', 'sales.units'),
        widget('w-trend', 'line', 'Sales over time', 'sales.trend'),
        widget('w-channel', 'bar', 'Sales by channel', 'sales.byChannel'),
        widget('w-products', 'table', 'Top products', 'sales.byProduct'),
      ],
      [
        { i: 'w-sales', x: 0, y: 0, w: 3, h: 2 },
        { i: 'w-aov', x: 3, y: 0, w: 3, h: 2 },
        { i: 'w-avg-day', x: 6, y: 0, w: 3, h: 2 },
        { i: 'w-units', x: 9, y: 0, w: 3, h: 2 },
        { i: 'w-trend', x: 0, y: 2, w: 8, h: 4 },
        { i: 'w-channel', x: 8, y: 2, w: 4, h: 4 },
        { i: 'w-products', x: 0, y: 6, w: 12, h: 4 },
      ],
    ),
  },
  {
    key: 'inventory-dashboard',
    nameEn: 'Inventory Dashboard',
    nameAr: 'لوحة المخزون',
    descriptionEn: 'Stock value, low-stock items, and category mix.',
    descriptionAr: 'قيمة المخزون والمواد المنخفضة وتوزيع التصنيفات.',
    config: createDashboardConfig(
      [
        widget('w-value', 'kpi', 'Inventory value', 'inventory.value'),
        widget('w-stock', 'kpi', 'Available stock', 'inventory.stock'),
        widget('w-low', 'kpi', 'Low stock items', 'inventory.lowStock'),
        widget('w-category', 'donut', 'Inventory by category', 'inventory.byCategory'),
        widget('w-table', 'table', 'Stock table', 'inventory.stock'),
      ],
      [
        { i: 'w-value', x: 0, y: 0, w: 4, h: 2 },
        { i: 'w-stock', x: 4, y: 0, w: 4, h: 2 },
        { i: 'w-low', x: 8, y: 0, w: 4, h: 2 },
        { i: 'w-category', x: 0, y: 2, w: 5, h: 4 },
        { i: 'w-table', x: 5, y: 2, w: 7, h: 4 },
      ],
    ),
  },
  {
    key: 'delivery-dashboard',
    nameEn: 'Delivery Dashboard',
    nameAr: 'لوحة التوصيل',
    descriptionEn: 'Open deliveries, completion rate, courier and status views.',
    descriptionAr: 'التوصيلات المفتوحة ونسبة الاكتمال وأداء الشركات والحالات.',
    config: createDashboardConfig(
      [
        widget('w-delivered', 'kpi', 'Delivered orders', 'fulfillment.delivered'),
        widget('w-open', 'kpi', 'Open deliveries', 'fulfillment.open'),
        widget('w-rate', 'kpi', 'Completion rate', 'fulfillment.completionRate'),
        widget('w-status', 'donut', 'Deliveries by status', 'fulfillment.byStatus'),
        widget('w-courier', 'bar', 'Courier performance', 'fulfillment.byCourier'),
      ],
      [
        { i: 'w-delivered', x: 0, y: 0, w: 4, h: 2 },
        { i: 'w-open', x: 4, y: 0, w: 4, h: 2 },
        { i: 'w-rate', x: 8, y: 0, w: 4, h: 2 },
        { i: 'w-status', x: 0, y: 2, w: 5, h: 4 },
        { i: 'w-courier', x: 5, y: 2, w: 7, h: 4 },
      ],
    ),
  },
  {
    key: 'financial-dashboard',
    nameEn: 'Financial Dashboard',
    nameAr: 'لوحة المالية',
    descriptionEn: 'Revenue, cash, receivables, payables, capex, opex, and COGS.',
    descriptionAr: 'الإيراد والنقد والمستحقات والصرف الرأسمالي والتشغيلي والتكلفة.',
    config: createDashboardConfig(
      [
        widget('w-revenue', 'kpi', 'Revenue', 'finance.revenue'),
        widget('w-cash', 'kpi', 'Cash available', 'finance.cash'),
        widget('w-receivables', 'kpi', 'Receivables', 'finance.receivables'),
        widget('w-payables', 'kpi', 'Payables', 'finance.payables'),
        widget('w-capex', 'kpi', 'Capex', 'finance.capex'),
        widget('w-opex', 'kpi', 'Opex', 'finance.opex'),
        widget('w-cogs', 'kpi', 'COGS', 'finance.cogs'),
        widget('w-category', 'donut', 'Spend by category', 'finance.spendByCategory'),
      ],
      [
        { i: 'w-revenue', x: 0, y: 0, w: 3, h: 2 },
        { i: 'w-cash', x: 3, y: 0, w: 3, h: 2 },
        { i: 'w-receivables', x: 6, y: 0, w: 3, h: 2 },
        { i: 'w-payables', x: 9, y: 0, w: 3, h: 2 },
        { i: 'w-capex', x: 0, y: 2, w: 4, h: 2 },
        { i: 'w-opex', x: 4, y: 2, w: 4, h: 2 },
        { i: 'w-cogs', x: 8, y: 2, w: 4, h: 2 },
        { i: 'w-category', x: 0, y: 4, w: 12, h: 4 },
      ],
    ),
  },
  {
    key: 'customer-dashboard',
    nameEn: 'Customer Dashboard',
    nameAr: 'لوحة العملاء',
    descriptionEn: 'Customer count, repeat customers, cities, and top customers.',
    descriptionAr: 'عدد العملاء والمتكررين والمدن وأفضل العملاء.',
    config: createDashboardConfig(
      [
        widget('w-customers', 'kpi', 'Customers', 'customers.total'),
        widget('w-repeat', 'kpi', 'Repeat customers', 'customers.repeat'),
        widget('w-city', 'bar', 'Customers by city', 'customers.byCity'),
        widget('w-top', 'table', 'Top customers', 'customers.top'),
      ],
      [
        { i: 'w-customers', x: 0, y: 0, w: 4, h: 2 },
        { i: 'w-repeat', x: 4, y: 0, w: 4, h: 2 },
        { i: 'w-city', x: 0, y: 2, w: 6, h: 4 },
        { i: 'w-top', x: 6, y: 2, w: 6, h: 4 },
      ],
    ),
  },
] as const;

export function emptyDashboardConfig(): DashboardConfig {
  return createDashboardConfig([], []);
}
