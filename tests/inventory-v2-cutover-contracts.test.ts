import { describe, expect, it } from 'vitest';
import {
  hasValidPositiveAdjustmentCost,
  inventoryCountPostingType,
  openingCountCoverage,
} from '@/server/inventory-v2/count-contracts';
import {
  finishedGoodsCategoryForProductLine,
  finishedGoodsDefinitionState,
  finishedGoodsExternalKey,
  isSellableInventoryCategory,
} from '@/server/inventory-v2/finished-goods-contracts';
import {
  buildInventoryVarianceLinePlan,
  inventoryVarianceLedgerClassification,
  inventoryVarianceOperatingAmount,
  varianceAccountCode,
} from '@/server/inventory-v2/inventory-variance';
import { runInventoryV2Preflight } from '@/server/inventory-v2/preflight';

describe('Inventory V2 cutover contracts', () => {
  it('requires exact active-policy coverage for an opening count, including zero rows', () => {
    expect(openingCountCoverage(['green', 'bags', 'finished'], ['green', 'bags', 'finished'])).toEqual({
      missingItemIds: [],
      unexpectedItemIds: [],
      complete: true,
    });
    expect(openingCountCoverage(['green', 'bags', 'finished'], ['green', 'finished', 'other'])).toEqual({
      missingItemIds: ['bags'],
      unexpectedItemIds: ['other'],
      complete: false,
    });
  });

  it('posts opening counts as opening documents and routine counts as adjustments', () => {
    expect(inventoryCountPostingType('OPENING')).toEqual({
      documentType: 'OPENING',
      movementReason: 'OPENING',
    });
    expect(inventoryCountPostingType('ROUTINE')).toEqual({
      documentType: 'ADJUSTMENT',
      movementReason: 'ADJUSTMENT',
    });
  });

  it('never permits an unvalued positive opening or count adjustment', () => {
    expect(hasValidPositiveAdjustmentCost(1, null)).toBe(false);
    expect(hasValidPositiveAdjustmentCost(1, 0)).toBe(false);
    expect(hasValidPositiveAdjustmentCost(1, 2500)).toBe(true);
    expect(hasValidPositiveAdjustmentCost(0, null)).toBe(true);
    expect(hasValidPositiveAdjustmentCost(-1, null)).toBe(true);
  });

  it('values gains from the item cost and shortages from the exact consumed lots', () => {
    expect(buildInventoryVarianceLinePlan({
      difference: 2.5,
      positiveUnitCost: 1_200,
    })).toMatchObject({
      direction: 'GAIN',
      quantity: 2.5,
      exactValue: 3_000,
      lineTotal: 3_000,
      averageUnitCost: 1_200,
    });
    expect(buildInventoryVarianceLinePlan({
      difference: -3,
      allocations: [
        { costLayerId: 'lot-old', quantity: 2, unitCost: 1_000 },
        { costLayerId: 'lot-new', quantity: 1, unitCost: 1_300 },
      ],
    })).toMatchObject({
      direction: 'LOSS',
      quantity: 3,
      exactValue: 3_300,
      lineTotal: 3_300,
      averageUnitCost: 1_100,
    });
    expect(() => buildInventoryVarianceLinePlan({
      difference: -2,
      allocations: [{ costLayerId: 'partial', quantity: 1, unitCost: 1_000 }],
    })).toThrow('count_variance_allocation_mismatch');
  });

  it('requires active location ledger codes and keeps opening balances out of operating profit', () => {
    const policy = {
      isActive: true,
      openingBalanceAccountCode: '1300.OPEN',
      inventoryGainAccountCode: '4900.GAIN',
      inventoryLossAccountCode: '5900.LOSS',
    };
    expect(varianceAccountCode(policy, 'OPENING', 'GAIN')).toBe('1300.OPEN');
    expect(varianceAccountCode(policy, 'ROUTINE', 'GAIN')).toBe('4900.GAIN');
    expect(varianceAccountCode(policy, 'ROUTINE', 'LOSS')).toBe('5900.LOSS');
    expect(varianceAccountCode({ ...policy, isActive: false }, 'ROUTINE', 'LOSS')).toBeNull();
    expect(inventoryVarianceOperatingAmount('INVENTORY_GAIN', 2_000, false)).toBe(-2_000);
    expect(inventoryVarianceOperatingAmount('INVENTORY_LOSS', 2_000, false)).toBe(2_000);
    expect(inventoryVarianceOperatingAmount('INVENTORY_LOSS', 2_000, true)).toBe(0);
  });

  it('keeps every stock-linked variance line on the canonical inventory item type', () => {
    expect(inventoryVarianceLedgerClassification(false)).toEqual({
      itemType: 'INVENTORY',
      spendTreatment: 'OPEX',
    });
    expect(inventoryVarianceLedgerClassification(true)).toEqual({
      itemType: 'INVENTORY',
      spendTreatment: 'INVENTORY',
    });
  });

  it('classifies exactly one company-wide sellable definition as ready', () => {
    expect(finishedGoodsDefinitionState([])).toBe('MISSING');
    expect(finishedGoodsDefinitionState([{ category: 'FINISHED_GOOD', branchId: null }])).toBe('READY');
    expect(finishedGoodsDefinitionState([{ category: 'ACCESSORY', branchId: null }])).toBe('READY');
    expect(finishedGoodsDefinitionState([{ category: 'PACKAGING', branchId: null }])).toBe('CONFLICT');
    expect(finishedGoodsDefinitionState([{ category: 'FINISHED_GOOD', branchId: 'branch' }])).toBe('CONFLICT');
    expect(finishedGoodsDefinitionState([
      { category: 'FINISHED_GOOD', branchId: null },
      { category: 'FINISHED_GOOD', branchId: null },
    ])).toBe('CONFLICT');
  });

  it('maps sellable product definitions and generates deterministic collision-safe keys', () => {
    expect(finishedGoodsCategoryForProductLine('ACCESSORIES')).toBe('ACCESSORY');
    expect(finishedGoodsCategoryForProductLine('ESPRESSO')).toBe('FINISHED_GOOD');
    expect(isSellableInventoryCategory('ACCESSORY')).toBe(true);
    expect(isSellableInventoryCategory('DRIP_BAGS')).toBe(false);
    expect(finishedGoodsExternalKey('sku-1', 'product-abcdef12', new Set())).toBe('FG-SKU-1');
    expect(finishedGoodsExternalKey('sku-1', 'product-abcdef12', new Set(['FG-SKU-1']))).toBe(
      'FG-SKU-1-ABCDEF12',
    );
  });

  it('keeps signed complete opening counts and canonical sellable definitions as preflight blockers', async () => {
    const sql: string[] = [];
    const db = {
      $queryRaw: async (query: { strings?: readonly string[] }) => {
        const rendered = query.strings?.join('?') ?? String(query);
        sql.push(rendered);
        if (rendered.includes('to_regclass')) return [{ exists: true }];
        return [{ count: 0, examples: [] }];
      },
    };
    const findings = await runInventoryV2Preflight(db as never);
    const queryText = sql.join('\n');
    expect(findings.map((finding) => finding.key)).toEqual(expect.arrayContaining([
      'opening_counts_missing',
      'opening_counts_incomplete',
      'opening_adjustments_without_cost',
      'variance_policies_missing',
      'count_variance_postings_missing',
      'invalid_count_variance_postings',
      'open_stock_discrepancies',
      'invalid_discrepancy_resolutions',
      'returned_waste_postings_missing',
      'duplicate_finance_reversals',
      'invalid_stock_document_reversals',
      'tracked_products_without_finished_item',
      'invalid_finished_item_definitions',
      'central_finished_policy_missing',
    ]));
    expect(queryText).toContain(`c.kind = 'OPENING'`);
    expect(queryText).toContain('c."openingAttestedAt" IS NOT NULL');
    expect(queryText).toContain(`'FINISHED_GOOD'::"InventoryCategory"`);
    expect(queryText).toContain(`'ACCESSORY'::"InventoryCategory"`);
    expect(queryText).toContain('"isOpeningBalance"');
    expect(queryText).toContain('"accountingCode"');
    expect(queryText).toContain('"stockEffectPending"');
    expect(queryText).toContain('"reviewIdempotencyKey"');
    expect(queryText).toContain(`'WASTE'::"ReturnDisposition"`);
    expect(queryText).toContain('HAVING COUNT(*) > 1');
    expect(queryText).toContain('reversal."reversalOfId" = source.id');
    expect(queryText).toContain('ABS(SUM(movement.quantity)) > 0.0005');
  });
});
