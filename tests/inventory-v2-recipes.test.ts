import { describe, expect, it } from 'vitest';
import { recipeSnapshotSignature } from '@/server/inventory-v2/recipe-versioning';

describe('Inventory V2 recipe snapshots', () => {
  it('is stable across database order and decimal representation', () => {
    const left = recipeSnapshotSignature([
      { inventoryItemId: 'bag', name: 'Bag', quantity: 1, unitCost: 100 },
      { inventoryItemId: 'coffee', name: 'Coffee', quantity: 0.225, unitCost: 20 },
    ]);
    const right = recipeSnapshotSignature([
      { inventoryItemId: 'coffee', name: 'Coffee', quantity: 0.2250, unitCost: 20.000 },
      { inventoryItemId: 'bag', name: 'Bag', quantity: 1.000, unitCost: 100.0 },
    ]);
    expect(left).toBe(right);
  });

  it('changes when a physical quantity, cost, or required flag changes', () => {
    const base = [{ inventoryItemId: 'bag', name: 'Bag', quantity: 1, unitCost: 100 }];
    expect(recipeSnapshotSignature(base)).not.toBe(recipeSnapshotSignature([{ ...base[0], quantity: 2 }]));
    expect(recipeSnapshotSignature(base)).not.toBe(recipeSnapshotSignature([{ ...base[0], unitCost: 101 }]));
    expect(recipeSnapshotSignature(base)).not.toBe(recipeSnapshotSignature([{ ...base[0], isRequired: false }]));
  });
});
