import type { InventoryCategory } from '@prisma/client';
import type { InventoryItemLike, MovementLike } from './types';

/** Current stock = signed sum of all movements. */
export function currentStock(movements: MovementLike[]): number {
  return movements.reduce((s, m) => s + m.quantity, 0);
}

/** Opening / additions / deductions / closing over a window. */
export function openingClosing(
  movements: MovementLike[],
  start: Date,
  end: Date,
): { opening: number; additions: number; deductions: number; closing: number } {
  let opening = 0;
  let additions = 0;
  let deductions = 0;
  for (const m of movements) {
    if (m.occurredAt < start) {
      opening += m.quantity;
    } else if (m.occurredAt <= end) {
      if (m.quantity >= 0) additions += m.quantity;
      else deductions += -m.quantity;
    }
  }
  return { opening, additions, deductions, closing: opening + additions - deductions };
}

/** Days of cover at average daily usage. Returns null when usage is unknown. */
export function coverageDays(currentStockValue: number, avgDailyUsage: number | null): number | null {
  if (!avgDailyUsage || avgDailyUsage <= 0) return null;
  return currentStockValue / avgDailyUsage;
}

export function sellThroughRate(unitsSold: number, unitsProduced: number): number {
  return unitsProduced > 0 ? unitsSold / unitsProduced : 0;
}

export interface StockRow {
  item: InventoryItemLike;
  current: number;
  coverageDays: number | null;
  belowReorder: boolean;
  value: number;
}

/** Compute a stock row (current level, coverage, reorder flag, value) per item. */
export function stockRow(item: InventoryItemLike): StockRow {
  const current = currentStock(item.movements);
  return {
    item,
    current,
    coverageDays: coverageDays(current, item.avgDailyUsage),
    belowReorder: item.reorderPoint != null && current <= item.reorderPoint,
    value: (item.unitCost ?? 0) * current,
  };
}

export function reorderAlerts(items: InventoryItemLike[]): StockRow[] {
  return items
    .map(stockRow)
    .filter((r) => r.belowReorder)
    .sort((a, b) => a.current - b.current);
}

export interface ExpiryRow {
  item: InventoryItemLike;
  expiryDate: Date;
  quantity: number;
  daysToExpiry: number;
}

/** Positive (in-stock) lots expiring within `withinDays`. */
export function nearExpiry(
  items: InventoryItemLike[],
  withinDays: number,
  now: Date = new Date(),
): ExpiryRow[] {
  const rows: ExpiryRow[] = [];
  const horizon = now.getTime() + withinDays * 86_400_000;
  for (const item of items) {
    for (const m of item.movements) {
      if (m.quantity > 0 && m.expiryDate) {
        const t = m.expiryDate.getTime();
        if (t <= horizon) {
          rows.push({
            item,
            expiryDate: m.expiryDate,
            quantity: m.quantity,
            daysToExpiry: Math.round((t - now.getTime()) / 86_400_000),
          });
        }
      }
    }
  }
  return rows.sort((a, b) => a.daysToExpiry - b.daysToExpiry);
}

export function stockValueByCategory(
  items: InventoryItemLike[],
): { category: InventoryCategory; value: number }[] {
  const map = new Map<InventoryCategory, number>();
  for (const item of items) {
    const value = (item.unitCost ?? 0) * currentStock(item.movements);
    map.set(item.category, (map.get(item.category) ?? 0) + value);
  }
  return [...map.entries()]
    .map(([category, value]) => ({ category, value }))
    .sort((a, b) => b.value - a.value);
}
