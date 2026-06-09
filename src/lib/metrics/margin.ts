import type { OrderLineLike, OrderLineWithProduct, ProductMarginRow } from './types';

/** COGS = sum of (unit COGS snapshot x quantity) across sold lines. */
export function cogs(lines: OrderLineLike[]): number {
  return lines.reduce((s, l) => s + l.unitCogsSnapshot * l.quantity, 0);
}

/** Health of a product's current price vs cost (§9/§17 alerts). */
export type MarginStatus = 'belowCost' | 'lowMargin' | 'ok';
export function marginStatus(sellingPrice: number, cogsPerUnit: number, lowThreshold = 0.15): MarginStatus {
  if (sellingPrice <= 0) return 'ok'; // no price set yet — don't flag
  if (cogsPerUnit > sellingPrice) return 'belowCost';
  return (sellingPrice - cogsPerUnit) / sellingPrice < lowThreshold ? 'lowMargin' : 'ok';
}

/** Gross margin amount and percentage. */
export function grossMargin(
  netSalesValue: number,
  cogsValue: number,
): { amount: number; pct: number } {
  const amount = netSalesValue - cogsValue;
  return { amount, pct: netSalesValue > 0 ? amount / netSalesValue : 0 };
}

/** Contribution margin = net sales - COGS - direct variable costs. */
export function contributionMargin(
  netSalesValue: number,
  cogsValue: number,
  directCosts: { delivery?: number; transaction?: number; discount?: number },
): number {
  const direct =
    (directCosts.delivery ?? 0) + (directCosts.transaction ?? 0) + (directCosts.discount ?? 0);
  return netSalesValue - cogsValue - direct;
}

/** Per-product margin rows, sorted by margin amount descending. */
export function productMargin(lines: OrderLineWithProduct[]): ProductMarginRow[] {
  const map = new Map<string, ProductMarginRow>();
  for (const l of lines) {
    const row =
      map.get(l.productId) ??
      ({
        productId: l.productId,
        sku: l.sku,
        name: { en: l.product.nameEn, ar: l.product.nameAr },
        units: 0,
        netSales: 0,
        cogs: 0,
        marginAmount: 0,
        marginPct: 0,
      } satisfies ProductMarginRow);
    row.units += l.quantity;
    row.netSales += l.lineNet;
    row.cogs += l.unitCogsSnapshot * l.quantity;
    map.set(l.productId, row);
  }
  const rows = [...map.values()];
  for (const r of rows) {
    r.marginAmount = r.netSales - r.cogs;
    r.marginPct = r.netSales > 0 ? r.marginAmount / r.netSales : 0;
  }
  return rows.sort((a, b) => b.marginAmount - a.marginAmount);
}

/** Cost per kg given a batch cost (minor units) and roasted output in grams. */
export function costPerKg(batchCostMinor: number, outputGrams: number): number {
  const kg = outputGrams / 1000;
  return kg > 0 ? batchCostMinor / kg : 0;
}

/** Cost per cup given per-unit COGS (minor units) and cups produced per unit. */
export function costPerCup(cogsPerUnitMinor: number, cupsPerUnit: number): number {
  return cupsPerUnit > 0 ? cogsPerUnitMinor / cupsPerUnit : 0;
}
