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
} from '@/lib/enums';

export type ImportDataset = 'products' | 'customers' | 'orders' | 'batches';

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
  roastDate: Date;
  packagingDate?: Date;
  origin: string;
  roastLevel: (typeof ROAST_LEVELS)[number];
  greenInputGrams: number;
  roastedOutputGrams: number;
  qcScore?: number;
  qcNotes?: string;
}

const batchSchema = z
  .object({
    batchNumber: z.string().min(1),
    roastDate: dateField,
    packagingDate: optDate,
    origin: z.string().min(1),
    roastLevel: z.enum(ROAST_LEVELS),
    greenInputGrams: reqInt.pipe(z.number().int().positive()),
    roastedOutputGrams: reqInt.pipe(z.number().int().positive()),
    qcScore: z.preprocess(blank, z.coerce.number().optional()),
    qcNotes: optStr,
  })
  .transform((r): BatchInput => ({ ...r, batchNumber: r.batchNumber.trim() }));

export const parseBatches = (rows: Raw[]) => parseEach(rows, batchSchema);

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
    headers: ['sku', 'nameEn', 'nameAr', 'productLine', 'sizeLabel', 'sizeGrams', 'grind', 'roastLevel', 'origin', 'sellingPrice', 'cogsPerUnit', 'active'],
    example: ['LH-ESP-SPRING-250-WB', 'Espresso Spring 250g', 'إسبريسو الربيع', 'ESPRESSO', '250g', '250', 'WHOLE_BEAN', 'MEDIUM_DARK', 'Blend', '13000', '6000', 'Active'],
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
};

export const IMPORT_DATASETS: ImportDataset[] = ['products', 'customers', 'orders', 'batches'];
