import { z } from 'zod';
import { PRODUCT_LINES, CUSTOMER_SEGMENTS, FULFILLMENT_METHODS } from './enums';

export const RANGE_PRESETS = [
  'today',
  'yesterday',
  '7d',
  'this_month',
  'last_month',
  'all',
  'custom',
] as const;

export const DashboardFiltersSchema = z.object({
  range: z.enum(RANGE_PRESETS).default('all'),
  from: z.string().optional(),
  to: z.string().optional(),
  // channel/governorate/grind/roastLevel are list-managed codes (BRD §9) —
  // plain strings so user-added values are filterable. Bad values just match
  // nothing; the remaining enum-backed filters keep strict validation.
  channel: z.array(z.string()).optional(),
  governorate: z.array(z.string()).optional(),
  productLine: z.array(z.enum(PRODUCT_LINES)).optional(),
  grind: z.array(z.string()).optional(),
  roastLevel: z.array(z.string()).optional(),
  sizeLabel: z.array(z.string()).optional(),
  productGroup: z.array(z.string()).optional(),
  segment: z.array(z.enum(CUSTOMER_SEGMENTS)).optional(),
  fulfillment: z.array(z.enum(FULFILLMENT_METHODS)).optional(),
  sku: z.array(z.string()).optional(),
  branchId: z.array(z.string()).optional(),
});

export type DashboardFilters = z.infer<typeof DashboardFiltersSchema>;

/** Multi-select array filter keys, serialized as comma-separated URL params. */
export const ARRAY_FILTER_KEYS = [
  'channel',
  'governorate',
  'productLine',
  'grind',
  'roastLevel',
  'sizeLabel',
  'productGroup',
  'segment',
  'fulfillment',
  'sku',
  'branchId',
] as const;

type SearchParamsInput = Record<string, string | string[] | undefined>;

/** Parse Next.js searchParams (or URLSearchParams entries) into typed filters. */
export function parseFilters(input: SearchParamsInput): DashboardFilters {
  const obj: Record<string, unknown> = {};
  for (const key of ['range', 'from', 'to'] as const) {
    const v = input[key];
    if (typeof v === 'string' && v) obj[key] = v;
  }
  for (const key of ARRAY_FILTER_KEYS) {
    const v = input[key];
    if (v === undefined) continue;
    const parts = (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(','));
    const cleaned = parts.map((s) => s.trim()).filter(Boolean);
    if (cleaned.length) obj[key] = cleaned;
  }
  const parsed = DashboardFiltersSchema.safeParse(obj);
  return parsed.success ? parsed.data : DashboardFiltersSchema.parse({});
}

/** Serialize filters back to URLSearchParams (arrays joined by commas). */
export function serializeFilters(f: Partial<DashboardFilters>): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.range) sp.set('range', f.range);
  if (f.from) sp.set('from', f.from);
  if (f.to) sp.set('to', f.to);
  for (const key of ARRAY_FILTER_KEYS) {
    const v = f[key];
    if (v && v.length) sp.set(key, v.join(','));
  }
  return sp;
}

export function hasActiveFilters(f: DashboardFilters): boolean {
  return ARRAY_FILTER_KEYS.some((k) => (f[k]?.length ?? 0) > 0);
}

/** Build a CSV export URL carrying the active filters + dataset + locale. */
export function buildExportHref(dataset: string, filters: DashboardFilters, locale: string): string {
  const sp = serializeFilters(filters);
  sp.set('dataset', dataset);
  sp.set('locale', locale);
  return `/api/export?${sp.toString()}`;
}

/** Build a Finance CSV export URL carrying active filters + report type. */
export function buildFinanceExportHref(
  type: string,
  filters: DashboardFilters,
  locale: string,
  extra?: Record<string, string | undefined>,
): string {
  const sp = serializeFilters(filters);
  sp.set('type', type);
  sp.set('locale', locale);
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) sp.set(key, value);
  }
  return `/api/finance/export?${sp.toString()}`;
}
