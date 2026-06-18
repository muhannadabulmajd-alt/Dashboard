import { describe, it, expect } from 'vitest';
import {
  currentStock,
  openingClosing,
  coverageDays,
  sellThroughRate,
  reorderAlerts,
  nearExpiry,
  stockValueByCategory,
  stockRow,
  productionCapacity,
  fifoStatus,
} from '@/lib/metrics/inventory';
import { makeItem, makeMovement } from '../fixtures/builders';

describe('inventory metrics', () => {
  const movements = [
    makeMovement({ reason: 'OPENING', quantity: 10_000, occurredAt: new Date('2026-04-01') }),
    makeMovement({ reason: 'PURCHASE', quantity: 5_000, occurredAt: new Date('2026-05-10') }),
    makeMovement({ reason: 'SOLD', quantity: -3_000, occurredAt: new Date('2026-05-12') }),
    makeMovement({ reason: 'WASTED', quantity: -500, occurredAt: new Date('2026-05-13') }),
  ];

  it('currentStock is the signed sum', () => {
    expect(currentStock(movements)).toBe(11_500);
  });

  it('openingClosing splits additions and deductions within a window', () => {
    const oc = openingClosing(movements, new Date('2026-05-01'), new Date('2026-05-31'));
    expect(oc.opening).toBe(10_000); // before window
    expect(oc.additions).toBe(5_000);
    expect(oc.deductions).toBe(3_500);
    expect(oc.closing).toBe(11_500);
  });

  it('coverageDays returns null without usage', () => {
    expect(coverageDays(10_000, 1_000)).toBe(10);
    expect(coverageDays(10_000, null)).toBeNull();
    expect(coverageDays(10_000, 0)).toBeNull();
  });

  it('sellThroughRate guards zero produced', () => {
    expect(sellThroughRate(30, 120)).toBe(0.25);
    expect(sellThroughRate(30, 0)).toBe(0);
  });

  it('reorderAlerts flags items at/under reorder point', () => {
    const low = makeItem({
      reorderPoint: 2_000,
      movements: [makeMovement({ reason: 'OPENING', quantity: 1_500 })],
    });
    const ok = makeItem({
      reorderPoint: 2_000,
      movements: [makeMovement({ reason: 'OPENING', quantity: 9_000 })],
    });
    const alerts = reorderAlerts([low, ok]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].item.id).toBe(low.id);
  });

  it('nearExpiry surfaces in-stock lots expiring soon', () => {
    const now = new Date('2026-06-01');
    const item = makeItem({
      movements: [
        makeMovement({ quantity: 500, expiryDate: new Date('2026-06-10') }), // 9 days
        makeMovement({ quantity: 500, expiryDate: new Date('2026-09-01') }), // far
        makeMovement({ quantity: -100, expiryDate: new Date('2026-06-05') }), // deduction, ignored
      ],
    });
    const rows = nearExpiry([item], 30, now);
    expect(rows).toHaveLength(1);
    expect(rows[0].daysToExpiry).toBe(9);
  });

  it('nearExpiry excludes a receipt lot after FIFO consumption depletes it', () => {
    const now = new Date('2026-06-01');
    const item = makeItem({
      movements: [
        makeMovement({ quantity: 100, occurredAt: new Date('2026-05-01'), expiryDate: new Date('2026-06-10') }),
        makeMovement({ quantity: 100, occurredAt: new Date('2026-05-02'), expiryDate: new Date('2026-07-10') }),
        makeMovement({ quantity: -100, occurredAt: new Date('2026-05-03') }),
      ],
    });
    expect(nearExpiry([item], 30, now)).toHaveLength(0);
  });

  it('stockRow values remaining FIFO layers and keeps pre-FIFO stock fallback', () => {
    const item = makeItem({
      unitCost: 10,
      movements: [
        makeMovement({ quantity: 50, occurredAt: new Date('2026-01-01') }),
        makeMovement({ quantity: 100, occurredAt: new Date('2026-02-01') }),
        makeMovement({ quantity: -40, occurredAt: new Date('2026-03-01') }),
      ],
      costLayers: [{ id: 'layer', qtyReceived: 100, unitCost: 20, receivedAt: new Date('2026-02-01') }],
    });
    expect(stockRow(item).current).toBe(110);
    expect(stockRow(item).value).toBe(60 * 20 + 50 * 10);
  });

  it('stockValueByCategory multiplies stock by unit cost', () => {
    const green = makeItem({
      category: 'GREEN_COFFEE',
      unitCost: 2,
      movements: [makeMovement({ quantity: 1_000 })],
    });
    const roasted = makeItem({
      category: 'ROASTED',
      unitCost: 5,
      movements: [makeMovement({ quantity: 200 })],
    });
    const vals = stockValueByCategory([green, roasted]);
    expect(vals.find((v) => v.category === 'GREEN_COFFEE')!.value).toBe(2_000);
    expect(vals.find((v) => v.category === 'ROASTED')!.value).toBe(1_000);
    // sorted descending
    expect(vals[0].category).toBe('GREEN_COFFEE');
  });

  it('productionCapacity = min producible across linked components (§7)', () => {
    const stock = new Map([
      ['beans', 10_000], // 250g each → 40
      ['bags', 1_000], //   1 each → 1000
      ['labels', 35], //    1 each → 35 (limiting)
    ]);
    const cap = productionCapacity(
      [
        { inventoryItemId: 'beans', quantity: 250 },
        { inventoryItemId: 'bags', quantity: 1 },
        { inventoryItemId: 'labels', quantity: 1 },
        { inventoryItemId: null, quantity: 1 }, // labor — ignored
      ],
      stock,
    );
    expect(cap.producible).toBe(35);
    expect(cap.limiting).toBe('labels');
  });

  it('productionCapacity is null when no linked components', () => {
    expect(productionCapacity([{ inventoryItemId: null, quantity: 1 }], new Map()).producible).toBeNull();
  });

  describe('fifoStatus (§8)', () => {
    const layers = [
      { id: 'a', qtyReceived: 100, unitCost: 2_000, receivedAt: new Date('2026-04-01') },
      { id: 'b', qtyReceived: 100, unitCost: 3_000, receivedAt: new Date('2026-05-01') },
    ];

    it('with nothing consumed the active cost is the oldest layer', () => {
      const s = fifoStatus(layers, 0);
      expect(s.activeCost).toBe(2_000);
      expect(s.totalRemaining).toBe(200);
      expect(s.value).toBe(100 * 2_000 + 100 * 3_000); // 500_000
      expect(s.layers.map((l) => l.remaining)).toEqual([100, 100]);
    });

    it('consuming into the first layer keeps it active at the oldest cost', () => {
      const s = fifoStatus(layers, 40);
      expect(s.activeCost).toBe(2_000);
      expect(s.totalRemaining).toBe(160);
      expect(s.layers[0].remaining).toBe(60);
    });

    it('depleting the first layer rolls the active cost to the next', () => {
      const s = fifoStatus(layers, 120); // 100 from A, 20 from B
      expect(s.activeCost).toBe(3_000);
      expect(s.totalRemaining).toBe(80);
      expect(s.layers[0].remaining).toBe(0);
      expect(s.layers[1].remaining).toBe(80);
      expect(s.value).toBe(80 * 3_000);
    });

    it('fully consumed leaves no active cost', () => {
      const s = fifoStatus(layers, 200);
      expect(s.activeCost).toBeNull();
      expect(s.totalRemaining).toBe(0);
      expect(s.value).toBe(0);
    });

    it('sorts unordered layers by receipt date before applying consumption', () => {
      const s = fifoStatus([layers[1], layers[0]], 120);
      expect(s.activeCost).toBe(3_000); // oldest (A) still depleted first
    });

    it('supports three-decimal quantities for fractional stock', () => {
      const s = fifoStatus(
        [
          { id: 'frac-a', qtyReceived: 0.75, unitCost: 1_200, receivedAt: new Date('2026-04-01') },
          { id: 'frac-b', qtyReceived: 1.25, unitCost: 1_500, receivedAt: new Date('2026-05-01') },
        ],
        0.5,
      );
      expect(s.activeCost).toBe(1_200);
      expect(s.totalRemaining).toBe(1.5);
      expect(s.layers.map((l) => l.remaining)).toEqual([0.25, 1.25]);
      expect(s.value).toBe(0.25 * 1_200 + 1.25 * 1_500);
    });

    it('returns null active cost with no layers', () => {
      expect(fifoStatus([], 0).activeCost).toBeNull();
    });
  });
});
