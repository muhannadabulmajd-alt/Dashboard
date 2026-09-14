import { describe, expect, it } from 'vitest';
import {
  getInventoryV2Config,
  requireInventoryV2Enabled,
} from '@/server/inventory-v2/config';
import { inventoryPreflightPassed } from '@/server/inventory-v2/preflight';

describe('Inventory V2 rollout safety', () => {
  it('defaults disabled and enables only for the exact true value', () => {
    expect(getInventoryV2Config({ INVENTORY_V2_ENABLED: undefined }).enabled).toBe(false);
    expect(getInventoryV2Config({ INVENTORY_V2_ENABLED: 'TRUE' }).enabled).toBe(false);
    expect(getInventoryV2Config({ INVENTORY_V2_ENABLED: 'true' }).enabled).toBe(true);
    expect(() => requireInventoryV2Enabled({ INVENTORY_V2_ENABLED: 'false' })).toThrow(
      'inventory_v2_disabled',
    );
  });

  it('blocks cutover on blockers but not warnings', () => {
    expect(inventoryPreflightPassed([])).toBe(true);
    expect(inventoryPreflightPassed([
      { key: 'fifo', severity: 'WARNING', count: 2, examples: [], message: 'warning' },
    ])).toBe(true);
    expect(inventoryPreflightPassed([
      { key: 'negative', severity: 'BLOCKER', count: 1, examples: [], message: 'blocker' },
    ])).toBe(false);
  });
});
