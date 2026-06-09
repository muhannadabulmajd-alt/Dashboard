import 'server-only';
import {
  CHANNELS,
  GOVERNORATES,
  PRODUCT_LINES,
  GRINDS,
  ROAST_LEVELS,
  CUSTOMER_SEGMENTS,
  CUSTOMER_SOURCES,
  FULFILLMENT_METHODS,
  ORDER_STATUSES,
  INVENTORY_CATEGORIES,
} from '@/lib/enums';

/** How a list is backed: an `enum` column (a fixed set until its column is
 * converted to text — relabel/reorder/hide only) or a free-text `soft` column
 * (new values are storable now). */
export type ListKind = 'enum' | 'soft';

export interface ListDef {
  key: string;
  base: readonly string[];
  kind: ListKind;
  /** Prisma model + field a value is stored in, for used-count + delete guard. */
  usage?: { model: string; field: string };
}

/** Every manageable system list (§9). `base` are the built-in codes; the
 * ListOption table overlays labels/order/active and adds new values. */
export const LISTS: ListDef[] = [
  { key: 'channel', base: CHANNELS, kind: 'enum', usage: { model: 'order', field: 'channel' } },
  { key: 'governorate', base: GOVERNORATES, kind: 'enum', usage: { model: 'order', field: 'governorate' } },
  { key: 'productLine', base: PRODUCT_LINES, kind: 'enum', usage: { model: 'product', field: 'productLine' } },
  { key: 'grind', base: GRINDS, kind: 'enum', usage: { model: 'product', field: 'grind' } },
  { key: 'roastLevel', base: ROAST_LEVELS, kind: 'enum', usage: { model: 'product', field: 'roastLevel' } },
  { key: 'customerSegment', base: CUSTOMER_SEGMENTS, kind: 'enum', usage: { model: 'customer', field: 'segment' } },
  { key: 'fulfillment', base: FULFILLMENT_METHODS, kind: 'enum', usage: { model: 'order', field: 'fulfillmentMethod' } },
  { key: 'orderStatus', base: ORDER_STATUSES, kind: 'enum', usage: { model: 'order', field: 'status' } },
  { key: 'inventoryCategory', base: INVENTORY_CATEGORIES, kind: 'enum', usage: { model: 'inventoryItem', field: 'category' } },
  { key: 'customerSource', base: CUSTOMER_SOURCES, kind: 'soft', usage: { model: 'customer', field: 'campaignSource' } },
  { key: 'productType', base: [], kind: 'soft', usage: { model: 'productGroup', field: 'productType' } },
  { key: 'variationType', base: [], kind: 'soft', usage: { model: 'product', field: 'variationType' } },
  { key: 'unit', base: ['g', 'kg', 'unit', 'bag', 'box', 'sachet'], kind: 'soft', usage: { model: 'inventoryItem', field: 'unit' } },
  { key: 'packaging', base: [], kind: 'soft' },
];

export const LIST_BY_KEY = new Map(LISTS.map((l) => [l.key, l]));

/** Soft lists accept brand-new values today; enum lists do until their column
 * is converted to text (tracked here so the UI/validation flip together). */
export function canAddValues(def: ListDef): boolean {
  return def.kind === 'soft';
}
