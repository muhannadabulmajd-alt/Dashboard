import type { InventoryCategory } from '@prisma/client';
import type { InventoryItemLike, MovementLike } from './types';

/** Current stock = signed sum of all movements. */
export function currentStock(movements: MovementLike[]): number {
  return movements.reduce((s, m) => s + m.quantity, 0);
}

export interface CostLayer {
  id: string;
  qtyReceived: number;
  unitCost: number;
  receivedAt: Date;
}
export interface LayerStatus extends CostLayer {
  remaining: number;
}
export interface FifoStatus {
  layers: LayerStatus[];
  activeCost: number | null; // oldest non-empty layer's unit cost
  totalRemaining: number;
  value: number; // Σ remaining × unitCost
}

/**
 * FIFO layer status (§8): apply total consumed quantity to immutable layers
 * oldest-first to derive each layer's remaining, the active (oldest non-empty)
 * cost, and the on-hand value. Deriving remaining means order edits/cancels
 * (which change the consumed total) adjust everything automatically.
 */
export function fifoStatus(layers: CostLayer[], totalConsumed: number): FifoStatus {
  const sorted = [...layers].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  let left = Math.max(0, totalConsumed);
  const out: LayerStatus[] = sorted.map((l) => {
    const consumed = Math.min(l.qtyReceived, left);
    left -= consumed;
    return { ...l, remaining: l.qtyReceived - consumed };
  });
  const active = out.find((l) => l.remaining > 0) ?? null;
  return {
    layers: out,
    activeCost: active ? active.unitCost : null,
    totalRemaining: out.reduce((s, l) => s + l.remaining, 0),
    value: out.reduce((s, l) => s + l.remaining * l.unitCost, 0),
  };
}

export interface RecipeComponent {
  inventoryItemId: string | null; // null = unlinked (labor/overhead) — doesn't constrain capacity
  quantity: number; // required per produced unit
}
export interface CapacityResult {
  /** Max whole units producible; null when no linked components (not tracked). */
  producible: number | null;
  limiting: string | null; // inventoryItemId of the binding component
  perComponent: { inventoryItemId: string; available: number; required: number; possible: number }[];
}

/**
 * How many units of a product can be produced from current component stock
 * (§7). The producible quantity is the minimum across linked components; the
 * limiting component is the one at that minimum. Unlinked rows are ignored.
 */
export function productionCapacity(components: RecipeComponent[], stockByItem: Map<string, number>): CapacityResult {
  const linked = components.filter((c) => c.inventoryItemId && c.quantity > 0);
  if (!linked.length) return { producible: null, limiting: null, perComponent: [] };
  const perComponent = linked.map((c) => {
    const available = stockByItem.get(c.inventoryItemId as string) ?? 0;
    return { inventoryItemId: c.inventoryItemId as string, available, required: c.quantity, possible: Math.floor(available / c.quantity) };
  });
  const producible = Math.min(...perComponent.map((p) => p.possible));
  const limiting = perComponent.find((p) => p.possible === producible)?.inventoryItemId ?? null;
  return { producible, limiting, perComponent };
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
  const layers = item.costLayers ?? [];
  const firstLayerAt = layers.length
    ? Math.min(...layers.map((layer) => layer.receivedAt.getTime()))
    : null;
  const consumedSinceLayers = firstLayerAt == null
    ? 0
    : -item.movements
        .filter((movement) => movement.quantity < 0 && movement.occurredAt.getTime() >= firstLayerAt)
        .reduce((sum, movement) => sum + movement.quantity, 0);
  const fifo = fifoStatus(layers, consumedSinceLayers);
  const preFifoRemaining = Math.max(0, current - fifo.totalRemaining);
  const value = layers.length
    ? fifo.value + preFifoRemaining * (item.unitCost ?? fifo.activeCost ?? 0)
    : (item.unitCost ?? 0) * current;
  return {
    item,
    current,
    coverageDays: coverageDays(current, item.avgDailyUsage),
    belowReorder: item.reorderPoint != null && current <= item.reorderPoint,
    value,
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
    const ordered = [...item.movements].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    let consumed = -ordered.filter((movement) => movement.quantity < 0).reduce((sum, movement) => sum + movement.quantity, 0);
    for (const m of ordered) {
      if (m.quantity > 0) {
        const used = Math.min(m.quantity, consumed);
        consumed -= used;
        const remaining = m.quantity - used;
        if (remaining <= 0 || !m.expiryDate) continue;
        const t = m.expiryDate.getTime();
        if (t <= horizon) {
          rows.push({
            item,
            expiryDate: m.expiryDate,
            quantity: remaining,
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
    const value = stockRow(item).value;
    map.set(item.category, (map.get(item.category) ?? 0) + value);
  }
  return [...map.entries()]
    .map(([category, value]) => ({ category, value }))
    .sort((a, b) => b.value - a.value);
}
