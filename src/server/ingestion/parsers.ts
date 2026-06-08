import { z } from 'zod';
import {
  CHANNELS,
  GOVERNORATES,
  PRODUCT_LINES,
  GRINDS,
  ROAST_LEVELS,
  CUSTOMER_SEGMENTS,
  FULFILLMENT_METHODS,
  ORDER_STATUSES,
  INVENTORY_CATEGORIES,
  CURRENCIES,
  EXPENSE_CATEGORY_TYPES,
  SHIPMENT_STATUSES,
} from '@/lib/enums';

export type ImportDataset =
  | 'products'
  | 'customers'
  | 'orders'
  | 'batches'
  | 'inventory'
  | 'purchases'
  | 'capital'
  | 'shipments';

export interface RowError {
  row: number;
  message: string;
}
export interface ParseResult<T> {
  valid: T[];
  errors: RowError[];
}

export interface IngestSummary {
  dataset: ImportDataset;
  rowsTotal: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: RowError[];
  uploadBatchId: string;
}

type Raw = Record<string, string>;

// --- field helpers ----------------------------------------------------------

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const reqInt = z.preprocess(blank, z.coerce.number().int());
const optInt = z.preprocess(blank, z.coerce.number().int().optional());
const optStr = z.preprocess(blank, z.string().optional());
const dateField = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() ? new Date(v) : undefined),
  z.date({ message: 'invalid date' }),
);
const optDate = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() ? new Date(v) : undefined),
  z.date().optional(),
);
const optEnum = <T extends readonly [string, ...string[]]>(vals: T) =>
  z.preprocess(blank, z.enum(vals).optional());

// Iraqi address data often uses the city name rather than the province; map the
// common ones to their governorate so they aren't rejected or dumped into OTHER.
const normEnum = (v: string) => v.trim().toUpperCase().replace(/[\s-]+/g, '_');
const GOVERNORATE_ALIASES: Record<string, (typeof GOVERNORATES)[number]> = {
  NINEVEH: 'MOSUL', NINAWA: 'MOSUL', NINAVA: 'MOSUL',
  KUT: 'WASIT',
  QADISIYAH: 'DIWANIYAH', QADISIYYAH: 'DIWANIYAH', AL_QADISIYAH: 'DIWANIYAH', DIWANIYA: 'DIWANIYAH',
  NASIRIYAH: 'DHI_QAR', NASIRIYA: 'DHI_QAR', THI_QAR: 'DHI_QAR', THIQAR: 'DHI_QAR',
  HILLA: 'BABYLON', HILLAH: 'BABYLON', BABIL: 'BABYLON',
  AMARA: 'MAYSAN', AMARAH: 'MAYSAN',
  SAMAWA: 'MUTHANNA', SAMAWAH: 'MUTHANNA',
  RAMADI: 'ANBAR', FALLUJA: 'ANBAR', FALLUJAH: 'ANBAR', AL_ANBAR: 'ANBAR',
  BAQUBA: 'DIYALA', BAQUBAH: 'DIYALA',
  TIKRIT: 'SALAHUDDIN', SALAH_AL_DIN: 'SALAHUDDIN', SALAH_ADDIN: 'SALAHUDDIN', SALAHALDIN: 'SALAHUDDIN',
  SULAIMANIYA: 'SULAYMANIYAH', SLEMANI: 'SULAYMANIYAH', SLEMANY: 'SULAYMANIYAH',
  HEWLER: 'ERBIL', HAWLER: 'ERBIL', ARBIL: 'ERBIL',
};
const govPre = (v: unknown) => {
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  const up = normEnum(v);
  return GOVERNORATE_ALIASES[up] ?? up;
};
const optGovernorate = z.preprocess(govPre, z.enum(GOVERNORATES).optional());
const reqGovernorate = z.preprocess(govPre, z.enum(GOVERNORATES));

// Courier / COD pipeline states map onto the order lifecycle. Revenue is only
// realized on completion, so any in-transit / on-hold state is treated as PENDING.
const ORDER_STATUS_ALIASES: Record<string, (typeof ORDER_STATUSES)[number]> = {
  DELIVERED: 'COMPLETED', DONE: 'COMPLETED', FULFILLED: 'COMPLETED', PAID: 'COMPLETED',
  RECEIVED_AT_WAREHOUSE: 'PENDING', AT_WAREHOUSE: 'PENDING', SENT_TO_CENTER: 'PENDING',
  IN_TRANSIT: 'PENDING', OUT_FOR_DELIVERY: 'PENDING', SHIPPED: 'PENDING',
  PROCESSING: 'PENDING', POSTPONED: 'PENDING', ON_HOLD: 'PENDING', CONFIRMED: 'PENDING',
  CANCELED: 'CANCELLED', RETURN: 'RETURNED', REFUND: 'REFUNDED',
};
const statusField = z.preprocess((v) => {
  if (typeof v !== 'string' || v.trim() === '') return 'COMPLETED';
  const up = normEnum(v);
  return ORDER_STATUS_ALIASES[up] ?? up;
}, z.enum(ORDER_STATUSES));

const FULFILLMENT_ALIASES: Record<string, (typeof FULFILLMENT_METHODS)[number]> = {
  HAND_DELIVERY: 'INTERNAL_DELIVERY', HAND: 'INTERNAL_DELIVERY', IN_HOUSE: 'INTERNAL_DELIVERY',
  DELIVERY: 'INTERNAL_DELIVERY', PICK_UP: 'PICKUP', STORE_PICKUP: 'PICKUP',
  WHOLESALE: 'B2B', BRANCH: 'BRANCH_SALE',
};
const fulfillmentField = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const up = normEnum(v);
  return FULFILLMENT_ALIASES[up] ?? up;
}, z.enum(FULFILLMENT_METHODS));

// Money is whole IQD. Tolerate decimals (e.g. a total split across a quantity)
// by rounding instead of rejecting the row.
const reqMoney = z.preprocess(blank, z.coerce.number().nonnegative().transform(Math.round));
const optMoney0 = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? 0 : v),
  z.coerce.number().nonnegative().transform(Math.round),
);
const boolField = z.preprocess((v) => {
  if (typeof v !== 'string' || v.trim() === '') return true;
  return ['active', 'true', '1', 'yes'].includes(v.trim().toLowerCase());
}, z.boolean());

function parseEach<T>(rows: Raw[], schema: z.ZodType<T>): ParseResult<T> {
  const valid: T[] = [];
  const errors: RowError[] = [];
  rows.forEach((row, i) => {
    const res = schema.safeParse(row);
    if (res.success) valid.push(res.data);
    else {
      errors.push({
        row: i + 2, // +1 header, +1 to 1-index
        message: res.error.issues.map((x) => `${x.path.join('.') || '?'}: ${x.message}`).join('; '),
      });
    }
  });
  return { valid, errors };
}

// --- Products ---------------------------------------------------------------

export interface ProductInput {
  sku: string;
  nameEn: string;
  nameAr: string;
  productLine: (typeof PRODUCT_LINES)[number];
  sizeLabel: string;
  sizeGrams?: number;
  grind: (typeof GRINDS)[number];
  roastLevel?: (typeof ROAST_LEVELS)[number];
  origin?: string;
  group?: string; // parent group name/code; auto-created + linked on import
  sellingPrice: number;
  cogsPerUnit: number;
  isActive: boolean;
}

// Real-world catalogs use category words the schema doesn't model 1:1 (e.g.
// "CUPS" for accessories, "DRIP_BAG" as a grind). Normalize casing/spacing and
// alias those to the closest supported enum value instead of rejecting the row.
const PRODUCT_LINE_ALIASES: Record<string, (typeof PRODUCT_LINES)[number]> = {
  CUP: 'ACCESSORIES',
  CUPS: 'ACCESSORIES',
  ACCESSORY: 'ACCESSORIES',
  DRIP_BAG: 'DRIP_BAGS',
  SINGLE: 'SINGLE_ORIGIN',
  BLEND: 'BLENDS',
};
const GRIND_ALIASES: Record<string, (typeof GRINDS)[number]> = {
  WHOLE: 'WHOLE_BEAN',
  WHOLEBEAN: 'WHOLE_BEAN',
  BEAN: 'WHOLE_BEAN',
  BEANS: 'WHOLE_BEAN',
  DRIP: 'NONE',
  DRIP_BAG: 'NONE',
  DRIP_BAGS: 'NONE',
  GROUND: 'FILTER',
  MOKA_POT: 'MOKA',
};

const productLineField = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const up = normEnum(v);
  return PRODUCT_LINE_ALIASES[up] ?? up;
}, z.enum(PRODUCT_LINES));

// Grind is optional in practice (cups/accessories have none) → default NONE.
const grindField = z.preprocess((v) => {
  if (typeof v !== 'string' || v.trim() === '') return 'NONE';
  const up = normEnum(v);
  return GRIND_ALIASES[up] ?? up;
}, z.enum(GRINDS));

const productSchema = z
  .object({
    sku: z.string().min(3),
    nameEn: optStr,
    nameAr: optStr,
    productLine: productLineField,
    sizeLabel: optStr,
    sizeGrams: optInt,
    grind: grindField,
    roastLevel: optEnum(ROAST_LEVELS),
    origin: optStr,
    group: optStr,
    sellingPrice: reqInt.pipe(z.number().int().nonnegative()),
    cogsPerUnit: reqInt.pipe(z.number().int().nonnegative()),
    active: boolField,
  })
  // Arabic-first catalog: one name is enough — mirror it to the other side.
  .refine((r) => Boolean(r.nameEn?.trim() || r.nameAr?.trim()), {
    path: ['nameEn'],
    message: 'a name is required (nameEn or nameAr)',
  })
  .transform((r): ProductInput => {
    const name = (r.nameEn?.trim() || r.nameAr?.trim()) ?? '';
    return {
      sku: r.sku.trim(),
      nameEn: r.nameEn?.trim() || name,
      nameAr: r.nameAr?.trim() || name,
      productLine: r.productLine,
      sizeLabel: r.sizeLabel?.trim() || (r.sizeGrams ? `${r.sizeGrams}g` : '—'),
      sizeGrams: r.sizeGrams,
      grind: r.grind,
      roastLevel: r.roastLevel,
      origin: r.origin,
      group: r.group?.trim() || undefined,
      sellingPrice: r.sellingPrice,
      cogsPerUnit: r.cogsPerUnit,
      isActive: r.active,
    };
  });

export const parseProducts = (rows: Raw[]) => parseEach(rows, productSchema);

// --- Customers --------------------------------------------------------------

export interface CustomerInput {
  externalId: string;
  phone?: string;
  email?: string;
  nameEn?: string;
  nameAr?: string;
  governorate?: (typeof GOVERNORATES)[number];
  segment: (typeof CUSTOMER_SEGMENTS)[number];
  campaignSource?: string;
}

const customerSchema = z
  .object({
    externalId: z.string().min(1),
    phone: optStr,
    email: optStr,
    nameEn: optStr,
    nameAr: optStr,
    governorate: optGovernorate,
    segment: z.preprocess(blank, z.enum(CUSTOMER_SEGMENTS).default('NEW')),
    campaignSource: optStr,
  })
  .transform((r): CustomerInput => ({ ...r, externalId: r.externalId.trim() }));

export const parseCustomers = (rows: Raw[]) => parseEach(rows, customerSchema);

// --- Batches ----------------------------------------------------------------

export interface BatchInput {
  batchNumber: string;
  roastDate?: Date;
  packagingDate?: Date;
  origin: string;
  roastLevel?: (typeof ROAST_LEVELS)[number];
  greenInputGrams: number;
  roastedOutputGrams?: number;
  qcScore?: number;
  qcNotes?: string;
}

const batchSchema = z
  .object({
    batchNumber: z.string().min(1),
    roastDate: optDate,
    packagingDate: optDate,
    origin: z.string().min(1),
    roastLevel: optEnum(ROAST_LEVELS),
    greenInputGrams: reqInt.pipe(z.number().int().positive()),
    roastedOutputGrams: z.preprocess(blank, z.coerce.number().int().positive().optional()),
    qcScore: z.preprocess(blank, z.coerce.number().optional()),
    qcNotes: optStr,
  })
  .transform((r): BatchInput => ({ ...r, batchNumber: r.batchNumber.trim() }));

export const parseBatches = (rows: Raw[]) => parseEach(rows, batchSchema);

// --- Inventory --------------------------------------------------------------

export interface InventoryInput {
  nameEn: string;
  nameAr: string;
  category: (typeof INVENTORY_CATEGORIES)[number];
  unit: string;
  opening: number;
  additions: number;
  deductions: number;
  unitCost?: number;
  reorderPoint?: number;
  avgDailyUsage?: number;
}

const INVENTORY_CATEGORY_ALIASES: Record<string, (typeof INVENTORY_CATEGORIES)[number]> = {
  PACKING: 'PACKAGING', PACKAGE: 'PACKAGING', BAGS: 'PACKAGING',
  GREEN: 'GREEN_COFFEE', GREEN_BEANS: 'GREEN_COFFEE', RAW: 'GREEN_COFFEE', BEANS: 'GREEN_COFFEE',
  ROAST: 'ROASTED', ROASTED_COFFEE: 'ROASTED',
  DRIP: 'DRIP_BAGS', DRIP_BAG: 'DRIP_BAGS',
  ACCESSORIES: 'ACCESSORY', ACCESSORIES_ITEM: 'ACCESSORY',
};
const invCategoryField = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const up = normEnum(v);
  return INVENTORY_CATEGORY_ALIASES[up] ?? up;
}, z.enum(INVENTORY_CATEGORIES));
const invInt = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? 0 : v),
  z.coerce.number().int().nonnegative(),
);

const invOptInt = z.preprocess(blank, z.coerce.number().int().nonnegative().optional());
const invOptNum = z.preprocess(blank, z.coerce.number().nonnegative().optional());

const inventorySchema = z
  .object({
    item: z.string().min(1),
    category: invCategoryField,
    unit: optStr,
    opening: invInt,
    additions: invInt,
    deductions: invInt,
    unitcost: invOptInt,
    reorderpoint: invOptInt,
    avgdailyusage: invOptNum,
  })
  .transform((r): InventoryInput => ({
    nameEn: r.item.trim(),
    nameAr: r.item.trim(),
    category: r.category,
    unit: r.unit?.trim() || 'unit',
    opening: r.opening,
    additions: r.additions,
    deductions: r.deductions,
    unitCost: r.unitcost,
    reorderPoint: r.reorderpoint,
    avgDailyUsage: r.avgdailyusage,
  }));

/** Inventory rows; header matching is case-insensitive (Item/item both work). */
export function parseInventory(rows: Raw[]): ParseResult<InventoryInput> {
  const lowered = rows.map((r) => {
    const o: Raw = {};
    for (const k of Object.keys(r)) o[k.trim().toLowerCase()] = r[k];
    return o;
  });
  return parseEach(lowered, inventorySchema);
}

// --- Finance: purchases & capital -------------------------------------------

const curField = z.preprocess(blank, z.enum(CURRENCIES).default('IQD'));

export interface PurchaseInput {
  amount: number; // major units in `currency` (converted to IQD on ingest)
  currency: (typeof CURRENCIES)[number];
  rate?: number; // IQD per $1 on the purchase date (used only when currency=USD)
  date: Date;
  supplier?: string;
  reference?: string;
  description: string;
  categoryType?: (typeof EXPENSE_CATEGORY_TYPES)[number];
  importKey: string;
}

/** Best-effort expense category from an Arabic/English item name (editable later). */
function inferCategory(item: string): (typeof EXPENSE_CATEGORY_TYPES)[number] | undefined {
  const s = item.toLowerCase();
  const has = (...kw: string[]) => kw.some((k) => s.includes(k));
  if (has('قهوة خام', 'بن خام', 'green')) return 'GREEN_COFFEE';
  if (has('شحن', 'توصيل')) return 'SHIPPING';
  if (has('ريكلام', 'اعلان', 'تسويق', 'ads')) return 'MARKETING';
  if (has('اودو', 'اوبريتنك', 'سيستم', 'نظام', 'اشتراك', 'سوفت', 'هوست', 'دومين', 'canva', 'كانفا')) return 'TECH';
  if (has('ايجار')) return 'RENT';
  if (has('راتب', 'رواتب')) return 'SALARIES';
  if (has('ماكنة', 'مكائن', 'جهاز', 'طابعة', 'معدات', 'ستيل', 'كبس', 'فلتر')) return 'EQUIPMENT';
  if (has('كهرباء', 'ماء', 'انترنت', 'هاتف')) return 'UTILITIES';
  if (has('كيس', 'علبة', 'علاكة', 'مغلف', 'قدح', 'كوب', 'باكيت', 'تغليف', 'ورقي', 'حافظة', 'كرتون', 'ستكر', 'ملصق'))
    return 'PACKAGING';
  return undefined;
}

const purchaseSchema = z
  .object({
    item: z.string().min(1),
    supplier: optStr,
    qty: optStr,
    unit: optStr,
    unitPrice: optStr,
    amount: z.preprocess(blank, z.coerce.number().nonnegative().optional()),
    currency: curField,
    rate: z.preprocess(blank, z.coerce.number().positive().optional()),
    date: dateField,
    invoice: optStr,
    doc: optStr,
    deliveryCompany: optStr,
  })
  .transform((r): PurchaseInput => {
    const amount = r.amount ?? 0;
    const ref = r.invoice?.trim() || r.doc?.trim() || undefined;
    const qtyUnit = [r.qty?.trim(), r.unit?.trim()].filter(Boolean).join(' ');
    const description =
      r.item.trim() +
      (qtyUnit ? ` (${qtyUnit})` : '') +
      (r.deliveryCompany?.trim() ? ` — ${r.deliveryCompany.trim()}` : '');
    const key = `PUR:${r.doc?.trim() || r.invoice?.trim() || r.item.trim()}:${r.date.toISOString().slice(0, 10)}:${amount}`;
    return {
      amount,
      currency: r.currency,
      rate: r.rate,
      date: r.date,
      supplier: r.supplier,
      reference: ref,
      description,
      categoryType: inferCategory(r.item),
      importKey: key,
    };
  });

export const parsePurchases = (rows: Raw[]) => parseEach(rows, purchaseSchema);

export interface CapitalInput {
  shareholder: string;
  amount: number; // major units
  currency: (typeof CURRENCIES)[number];
  date: Date;
  reference?: string;
  importKey: string;
}

const capitalSchema = z
  .object({
    shareholder: z.string().min(1),
    amount: reqInt.pipe(z.number().int().nonnegative()),
    currency: curField,
    date: dateField,
    reference: optStr,
  })
  .transform((r): CapitalInput => ({
    shareholder: r.shareholder.trim(),
    amount: r.amount,
    currency: r.currency,
    date: r.date,
    reference: r.reference,
    importKey: `CAP:${r.shareholder.trim()}:${r.date.toISOString().slice(0, 10)}:${r.amount}:${r.reference?.trim() ?? ''}`,
  }));

export const parseCapital = (rows: Raw[]) => parseEach(rows, capitalSchema);

// --- Shipments (courier delivery report) ------------------------------------

export interface ShipmentInput {
  orderNumber: string;
  courier?: string;
  status: (typeof SHIPMENT_STATUSES)[number];
  governorate?: (typeof GOVERNORATES)[number];
  shippingCost: number;
  dispatchedAt?: Date;
  deliveredAt?: Date;
  failureReason?: string;
}

// Courier reports describe the delivery lifecycle in their own words (Arabic and
// English). Normalize to the Shipment status enum; anything unknown stays as-is
// and is rejected so it surfaces in the error report rather than silently wrong.
const SHIPMENT_STATUS_ALIASES: Record<string, (typeof SHIPMENT_STATUSES)[number]> = {
  DELIVERED: 'DELIVERED', DONE: 'DELIVERED', COMPLETED: 'DELIVERED', SUCCESS: 'DELIVERED',
  DISPATCHED: 'DISPATCHED', SENT: 'DISPATCHED', SHIPPED: 'DISPATCHED', PICKED_UP: 'DISPATCHED',
  IN_TRANSIT: 'IN_TRANSIT', OUT_FOR_DELIVERY: 'IN_TRANSIT', ON_THE_WAY: 'IN_TRANSIT',
  PROCESSING: 'IN_TRANSIT', AT_WAREHOUSE: 'IN_TRANSIT',
  FAILED: 'FAILED', CANCELLED: 'FAILED', CANCELED: 'FAILED', POSTPONED: 'FAILED', REJECTED: 'FAILED',
  RETURNED: 'RETURNED', RETURN: 'RETURNED',
};
const shipStatusField = z.preprocess((v) => {
  if (typeof v !== 'string' || v.trim() === '') return 'DISPATCHED';
  const up = normEnum(v);
  return SHIPMENT_STATUS_ALIASES[up] ?? up;
}, z.enum(SHIPMENT_STATUSES));

const shipmentSchema = z
  .object({
    orderNumber: z.string().min(1),
    courier: optStr,
    status: shipStatusField,
    governorate: optGovernorate,
    shippingCost: optMoney0,
    dispatchedAt: optDate,
    deliveredAt: optDate,
    failureReason: optStr,
  })
  .transform((r): ShipmentInput => ({ ...r, orderNumber: r.orderNumber.trim() }));

export const parseShipments = (rows: Raw[]) => parseEach(rows, shipmentSchema);

// --- Orders (one CSV row per order line) ------------------------------------

export interface OrderLineInput {
  sku: string;
  quantity: number;
  unitGrossPrice: number;
  lineDiscount: number;
}
export interface OrderInput {
  orderNumber: string;
  placedAt: Date;
  customerExternalId?: string;
  channel: (typeof CHANNELS)[number];
  governorate: (typeof GOVERNORATES)[number];
  fulfillmentMethod: (typeof FULFILLMENT_METHODS)[number];
  status: (typeof ORDER_STATUSES)[number];
  deliveryFee: number;
  deliveryCost: number;
  lines: OrderLineInput[];
}

const orderRowSchema = z.object({
  orderNumber: z.string().min(1),
  placedAt: dateField,
  customerExternalId: optStr,
  channel: z.enum(CHANNELS),
  governorate: reqGovernorate,
  fulfillmentMethod: fulfillmentField,
  status: statusField,
  sku: z.string().min(1),
  quantity: reqInt.pipe(z.number().int().positive()),
  unitGrossPrice: reqMoney,
  lineDiscount: optMoney0,
  deliveryFee: optMoney0,
  deliveryCost: optMoney0,
});

/** Validate order-line rows and group them into orders by order number. */
export function parseOrders(rows: Raw[]): ParseResult<OrderInput> {
  const { valid, errors } = parseEach(rows, orderRowSchema);
  const byOrder = new Map<string, OrderInput>();
  for (const r of valid) {
    const key = r.orderNumber.trim();
    let order = byOrder.get(key);
    if (!order) {
      order = {
        orderNumber: key,
        placedAt: r.placedAt,
        customerExternalId: r.customerExternalId,
        channel: r.channel,
        governorate: r.governorate,
        fulfillmentMethod: r.fulfillmentMethod,
        status: r.status,
        deliveryFee: r.deliveryFee,
        deliveryCost: r.deliveryCost,
        lines: [],
      };
      byOrder.set(key, order);
    }
    order.lines.push({
      sku: r.sku.trim(),
      quantity: r.quantity,
      unitGrossPrice: r.unitGrossPrice,
      lineDiscount: r.lineDiscount,
    });
  }
  return { valid: [...byOrder.values()], errors };
}

// --- Templates (headers + one example row) ----------------------------------

export const TEMPLATES: Record<ImportDataset, { headers: string[]; example: string[] }> = {
  products: {
    headers: ['sku', 'nameEn', 'nameAr', 'productLine', 'sizeLabel', 'sizeGrams', 'grind', 'roastLevel', 'origin', 'group', 'sellingPrice', 'cogsPerUnit', 'active'],
    example: ['LH-ESP-SPRING-250-WB', 'Espresso Spring 250g', 'إسبريسو الربيع', 'ESPRESSO', '250g', '250', 'WHOLE_BEAN', 'MEDIUM_DARK', 'Blend', 'Espresso Spring', '13000', '6000', 'Active'],
  },
  customers: {
    headers: ['externalId', 'phone', 'email', 'nameEn', 'nameAr', 'governorate', 'segment', 'campaignSource'],
    example: ['C-1001', '+9647700000000', '', 'Ahmed', 'أحمد', 'BAGHDAD', 'NEW', 'instagram'],
  },
  orders: {
    headers: ['orderNumber', 'placedAt', 'customerExternalId', 'channel', 'governorate', 'fulfillmentMethod', 'status', 'sku', 'quantity', 'unitGrossPrice', 'lineDiscount', 'deliveryFee', 'deliveryCost'],
    example: ['LH-O-90001', '2026-06-01 14:30', 'C-1001', 'ONLINE_STORE', 'BAGHDAD', 'COURIER', 'COMPLETED', 'LH-ESP-SPRING-250-WB', '2', '13000', '0', '4000', '5000'],
  },
  batches: {
    headers: ['batchNumber', 'roastDate', 'packagingDate', 'origin', 'roastLevel', 'greenInputGrams', 'roastedOutputGrams', 'qcScore', 'qcNotes'],
    example: ['LH-2026-0100', '2026-06-01', '2026-06-02', 'Ethiopia', 'LIGHT', '30000', '25500', '86.5', 'Bright, floral'],
  },
  inventory: {
    headers: ['item', 'category', 'unit', 'opening', 'additions', 'deductions', 'unitCost', 'reorderPoint', 'avgDailyUsage'],
    example: ['قهوة خام برازيل ريو ميناس', 'GREEN_COFFEE', 'GRAM', '0', '30000', '5000', '15', '5000', '200'],
  },
  purchases: {
    headers: ['item', 'supplier', 'qty', 'unit', 'unitPrice', 'amount', 'currency', 'rate', 'date', 'invoice', 'doc', 'deliveryCompany'],
    example: ['قهوة خام برازيل', 'بوابة الرافدين', '30', 'كيلو', '15000', '450000', 'IQD', '', '2026-03-15', '1572307', 'DOC000102', 'سما السندباد'],
  },
  capital: {
    headers: ['shareholder', 'amount', 'date', 'currency', 'reference'],
    example: ['مهند منجد', '1000000', '2026-01-15', 'IQD', 'DOC000149'],
  },
  shipments: {
    headers: ['orderNumber', 'courier', 'status', 'governorate', 'shippingCost', 'dispatchedAt', 'deliveredAt', 'failureReason'],
    example: ['LH-O-90001', 'سما السندباد', 'DELIVERED', 'BAGHDAD', '5000', '2026-06-01', '2026-06-03', ''],
  },
};

export const IMPORT_DATASETS: ImportDataset[] = [
  'products',
  'customers',
  'orders',
  'batches',
  'inventory',
  'purchases',
  'capital',
  'shipments',
];
