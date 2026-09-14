import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => unknown>(callback: T) => callback,
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/server/auth/session', () => ({ getCurrentUser: vi.fn(async () => null) }));

import type { CurrentUser } from '@/server/auth/session';
import { createTrustedCommandContext } from '@/server/commands/actor-context';
import { prisma } from '@/server/db/client';
import { formatProductBarcode, formatRetailBarcode } from '@/lib/barcode';
import { getLocationAvailability } from '@/server/inventory-v2/availability';
import { inventoryReadTransaction } from '@/server/inventory-v2/read-transaction';
import { rejectInventoryCount, submitInventoryCount } from '@/server/inventory-v2/counts';
import { resolveStockDiscrepancy } from '@/server/inventory-v2/discrepancies';
import { recordLocalExpense, reviewLocalExpense } from '@/server/inventory-v2/local-expenses';
import { packFinishedGoods } from '@/server/inventory-v2/packing';
import { receivePurchasedStock } from '@/server/inventory-v2/receipts';
import { reviewReplenishmentRequest } from '@/server/inventory-v2/replenishments';
import { reverseStockDocument } from '@/server/inventory-v2/reversals';
import { roastGreenCoffee } from '@/server/inventory-v2/roasting';
import {
  disposeReturnedGoods,
  returnFinishedGoodsToQuarantine,
} from '@/server/inventory-v2/returns';
import {
  dispatchStockTransfer,
  receiveStockTransfer,
} from '@/server/inventory-v2/transfers';
import { createOrderFromInput } from '@/server/records/orders';

const integrationEnabled = process.env.INVENTORY_V2_INTEGRATION === '1';
const describeIntegration = integrationEnabled ? describe.sequential : describe.skip;
const remoteIntegrationTimeout = 600_000;
const runId = randomUUID().slice(0, 8);
const runMarker = `inv2-${runId}`;
const phoneSeed = Number.parseInt(runId, 16) % 10_000_000;
const barcodeSequence = (Number.parseInt(runId, 16) % 999_999_999) + 1;
const eventBase = new Date(Date.now() - 60 * 60_000);
eventBase.setMilliseconds(0);

type LocationFixture = {
  id: string;
  stockVersion: number;
};

type ItemFixture = {
  id: string;
};

function at(minutes: number): Date {
  return new Date(eventBase.getTime() + minutes * 60_000);
}

function fixturePhone(offset: number): string {
  return `+964770${String((phoneSeed + offset) % 10_000_000).padStart(7, '0')}`;
}

function assertSafeIntegrationDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  const localhost = /(?:localhost|127\.0\.0\.1):\d+/.test(url);
  if (!localhost && process.env.INVENTORY_V2_DATABASE_ISOLATED !== 'true') {
    throw new Error('inventory_v2_integration_requires_isolated_database');
  }
}

async function locationVersion(locationId: string): Promise<number> {
  return (await prisma.stockLocation.findUniqueOrThrow({
    where: { id: locationId },
    select: { stockVersion: true },
  })).stockVersion;
}

async function availability(inventoryItemId: string, locationId: string) {
  return inventoryReadTransaction((tx) => getLocationAvailability(
    tx,
    inventoryItemId,
    locationId,
    at(30),
  ));
}

async function movementBalance(inventoryItemId: string, locationId: string): Promise<number> {
  const result = await prisma.stockMovement.aggregate({
    where: { inventoryItemId, locationId },
    _sum: { quantity: true },
  });
  return Number(result._sum.quantity ?? 0);
}

describeIntegration('Inventory V2 production-shaped database workflows', {
  timeout: remoteIntegrationTimeout,
}, () => {
  let previousInventoryFlag: string | undefined;
  let branchId: string;
  let owner: CurrentUser;
  let manager: CurrentUser;
  let production: LocationFixture;
  let salesPoint: LocationFixture;
  let transit: LocationFixture;
  let quarantine: LocationFixture;
  let green: ItemFixture;
  let roasted: ItemFixture;
  let packaging: ItemFixture;
  let finished: ItemFixture;
  let product: { id: string; sku: string; sellingPrice: number };
  let recipeVersionId: string;
  let salesAccountId: string;
  let outputLotId: string;
  let roastDocumentId: string;
  let completedOrderId: string;
  let completedOrderLineId: string;

  beforeAll(async () => {
    assertSafeIntegrationDatabase();
    previousInventoryFlag = process.env.INVENTORY_V2_ENABLED;
    process.env.INVENTORY_V2_ENABLED = 'true';

    const branch = await prisma.branch.create({
      data: {
        code: `INV2-${runId.toUpperCase()}`,
        nameEn: `Inventory V2 ${runId}`,
        nameAr: `Inventory V2 ${runId}`,
        branchType: 'COMPANY',
        governorate: 'BAGHDAD',
        city: 'Baghdad',
        address: `Integration fixture ${runMarker}`,
        hasPos: true,
        hasWarehouse: true,
        trackInventory: true,
      },
      select: { id: true },
    });
    branchId = branch.id;

    const ownerRow = await prisma.user.create({
      data: {
        email: `${runMarker}-owner@example.invalid`,
        name: `Inventory V2 Owner ${runId}`,
        hashedPassword: 'inventory-v2-integration-user-not-for-login',
        role: 'OWNER',
        branchId,
      },
      select: { id: true, email: true, name: true, role: true, branchId: true },
    });

    const locationRows = await prisma.$transaction([
      prisma.stockLocation.create({
        data: {
          branchId,
          code: `INV2-${runId.toUpperCase()}-PACK`,
          nameEn: 'Integration packing',
          nameAr: 'Integration packing',
          type: 'PACKING',
        },
        select: { id: true, stockVersion: true },
      }),
      prisma.stockLocation.create({
        data: {
          branchId,
          code: `INV2-${runId.toUpperCase()}-SALE`,
          nameEn: 'Integration sales point',
          nameAr: 'Integration sales point',
          type: 'SALES_POINT',
        },
        select: { id: true, stockVersion: true },
      }),
      prisma.stockLocation.create({
        data: {
          branchId,
          code: `INV2-${runId.toUpperCase()}-TRANSIT`,
          nameEn: 'Integration in transit',
          nameAr: 'Integration in transit',
          type: 'IN_TRANSIT',
          isSystem: true,
        },
        select: { id: true, stockVersion: true },
      }),
      prisma.stockLocation.create({
        data: {
          branchId,
          code: `INV2-${runId.toUpperCase()}-QUAR`,
          nameEn: 'Integration quarantine',
          nameAr: 'Integration quarantine',
          type: 'QUARANTINE',
          isSystem: true,
        },
        select: { id: true, stockVersion: true },
      }),
    ]);
    [production, salesPoint, transit, quarantine] = locationRows;

    salesAccountId = (await prisma.financeAccount.create({
      data: {
        externalKey: `INV2_${runId.toUpperCase()}_CASH`,
        name: `Inventory V2 cash ${runId}`,
        type: 'CASH',
        branchId,
        stockLocationId: salesPoint.id,
        currency: 'IQD',
      },
      select: { id: true },
    })).id;

    const managerRow = await prisma.user.create({
      data: {
        email: `${runMarker}-manager@example.invalid`,
        name: `Inventory V2 Manager ${runId}`,
        hashedPassword: 'inventory-v2-integration-user-not-for-login',
        role: 'BRANCH_MANAGER',
        branchId,
        defaultStockLocationId: salesPoint.id,
        defaultFinanceAccountId: salesAccountId,
        stockLocationAccesses: {
          create: {
            locationId: salesPoint.id,
            canView: true,
            canSell: true,
            canReceive: true,
            canCount: true,
            canRecordExpense: true,
          },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        branchId: true,
        defaultStockLocationId: true,
        defaultFinanceAccountId: true,
      },
    });

    owner = { ...ownerRow, defaultStockLocationId: production.id, locationIds: [] };
    manager = { ...managerRow, locationIds: [salesPoint.id] };

    product = await prisma.product.create({
      data: {
        sku: `INV2-${runId.toUpperCase()}-225-WB`,
        barcodeValue: formatProductBarcode(barcodeSequence),
        retailBarcode: formatRetailBarcode(barcodeSequence),
        nameEn: `Inventory V2 coffee ${runId}`,
        nameAr: `Inventory V2 coffee ${runId}`,
        productLine: 'FILTER',
        sizeGrams: 225,
        sizeLabel: '225 g',
        grind: 'WHOLE_BEAN',
        roastLevel: 'MEDIUM',
        origin: 'Integration origin',
        sellingPrice: 10_000,
        cogsPerUnit: 0,
        trackInventory: true,
      },
      select: { id: true, sku: true, sellingPrice: true },
    });

    const itemRows = await prisma.$transaction([
      prisma.inventoryItem.create({
        data: {
          externalKey: `INV2_${runId.toUpperCase()}_GREEN`,
          category: 'GREEN_COFFEE',
          nameEn: `Green coffee ${runId}`,
          nameAr: `Green coffee ${runId}`,
          unit: 'g',
        },
        select: { id: true },
      }),
      prisma.inventoryItem.create({
        data: {
          externalKey: `INV2_${runId.toUpperCase()}_ROASTED`,
          category: 'ROASTED',
          nameEn: `Roasted WIP ${runId}`,
          nameAr: `Roasted WIP ${runId}`,
          unit: 'g',
        },
        select: { id: true },
      }),
      prisma.inventoryItem.create({
        data: {
          externalKey: `INV2_${runId.toUpperCase()}_BAG`,
          category: 'PACKAGING',
          nameEn: `Coffee bag ${runId}`,
          nameAr: `Coffee bag ${runId}`,
          unit: 'unit',
        },
        select: { id: true },
      }),
      prisma.inventoryItem.create({
        data: {
          externalKey: `INV2_${runId.toUpperCase()}_FINISHED`,
          category: 'FINISHED_GOOD',
          productId: product.id,
          nameEn: `Packed coffee ${runId}`,
          nameAr: `Packed coffee ${runId}`,
          unit: 'unit',
        },
        select: { id: true },
      }),
    ]);
    [green, roasted, packaging, finished] = itemRows;

    await prisma.inventoryLocationPolicy.createMany({
      data: [
        { inventoryItemId: green.id, locationId: production.id, canProduce: true },
        { inventoryItemId: roasted.id, locationId: production.id, canProduce: true },
        { inventoryItemId: packaging.id, locationId: production.id, canProduce: true },
        { inventoryItemId: finished.id, locationId: production.id, canSell: true },
        { inventoryItemId: finished.id, locationId: salesPoint.id, canSell: true },
      ],
    });

    recipeVersionId = (await prisma.productRecipeVersion.create({
      data: {
        productId: product.id,
        version: 1,
        effectiveFrom: at(0),
        isActive: true,
        createdById: owner.id,
        notes: runMarker,
        components: {
          create: [
            {
              inventoryItemId: roasted.id,
              name: 'Roasted coffee',
              quantity: '225.000',
              unitCost: '0.000',
            },
            {
              inventoryItemId: packaging.id,
              name: 'Coffee bag',
              quantity: '1.000',
              unitCost: '0.000',
            },
          ],
        },
      },
      select: { id: true },
    })).id;
  }, remoteIntegrationTimeout);

  afterAll(() => {
    if (previousInventoryFlag === undefined) delete process.env.INVENTORY_V2_ENABLED;
    else process.env.INVENTORY_V2_ENABLED = previousInventoryFlag;
  });

  it('conserves exact lots through receive, roast, pack, dispatch, and receipt with safe replay', async () => {
    const greenReceiptInput = {
      inventoryItemId: green.id,
      locationId: production.id,
      quantity: 1_100,
      unitCost: 10,
      occurredAt: at(1),
      supplierLot: `GREEN-${runId}`,
      reference: `GREEN-${runId}`,
      paymentMode: 'CREDIT' as const,
      newSupplier: { name: `Green supplier ${runId}` },
      idempotencyKey: `${runMarker}:receive-green`,
      expectedLocationVersion: production.stockVersion,
    };
    const greenReceipt = await receivePurchasedStock(owner, greenReceiptInput);
    expect(greenReceipt).toMatchObject({ replayed: false, stockVersion: 2 });
    await expect(receivePurchasedStock(owner, greenReceiptInput)).resolves.toMatchObject({
      stockDocumentId: greenReceipt.stockDocumentId,
      replayed: true,
      stockVersion: 2,
    });
    await expect(receivePurchasedStock(owner, {
      ...greenReceiptInput,
      reference: `${greenReceiptInput.reference}-changed`,
    })).rejects.toMatchObject({ failure: { code: 'idempotency_conflict' } });

    const bagReceiptInput = {
      inventoryItemId: packaging.id,
      locationId: production.id,
      quantity: 10,
      unitCost: 500,
      occurredAt: at(2),
      reference: `BAGS-${runId}`,
      paymentMode: 'CREDIT' as const,
      newSupplier: { name: `Packaging supplier ${runId}` },
      idempotencyKey: `${runMarker}:receive-bags`,
      expectedLocationVersion: 2,
    };
    await expect(receivePurchasedStock(owner, bagReceiptInput)).resolves.toMatchObject({
      replayed: false,
      stockVersion: 3,
    });

    const roastInput = {
      batchNumber: `INV2-RST-${runId.toUpperCase()}`,
      locationId: production.id,
      greenInventoryItemId: green.id,
      roastedInventoryItemId: roasted.id,
      origin: 'Integration origin',
      roastLevel: 'MEDIUM',
      greenInputGrams: 1_100,
      roastedOutputGrams: 900,
      abnormalLossGrams: 0,
      roastDate: at(3),
      qcScore: 90,
      qcNotes: runMarker,
      idempotencyKey: `${runMarker}:roast`,
      expectedLocationVersion: 3,
    };
    const roast = await roastGreenCoffee(owner, roastInput);
    roastDocumentId = roast.stockDocumentId;
    expect(roast).toMatchObject({ replayed: false, stockVersion: 4, inputCost: 11_000 });
    await expect(roastGreenCoffee(owner, roastInput)).resolves.toMatchObject({
      roastBatchId: roast.roastBatchId,
      replayed: true,
    });
    await expect(roastGreenCoffee(owner, {
      ...roastInput,
      roastedOutputGrams: 899,
    })).rejects.toMatchObject({ failure: { code: 'idempotency_conflict' } });

    const packInput = {
      locationId: production.id,
      productId: product.id,
      outputInventoryItemId: finished.id,
      recipeVersionId,
      outputQuantity: 4,
      rejectedQuantity: 0,
      packedAt: at(4),
      bestBefore: at(60 * 24 * 180),
      notes: runMarker,
      idempotencyKey: `${runMarker}:pack`,
      expectedLocationVersion: 4,
    };
    const packed = await packFinishedGoods(owner, packInput);
    outputLotId = packed.outputLotId;
    expect(packed).toMatchObject({
      replayed: false,
      stockVersion: 5,
      totalCost: 12_999.8,
      unitCost: 3_249.95,
    });
    await expect(packFinishedGoods(owner, packInput)).resolves.toMatchObject({
      packingBatchId: packed.packingBatchId,
      outputLotId,
      replayed: true,
    });
    await expect(packFinishedGoods(owner, {
      ...packInput,
      outputQuantity: 3,
    })).rejects.toMatchObject({ failure: { code: 'idempotency_conflict' } });

    const dispatchInput = {
      sourceLocationId: production.id,
      destinationLocationId: salesPoint.id,
      lines: [{ inventoryItemId: finished.id, quantity: 2 }],
      occurredAt: at(5),
      expectedAt: at(6),
      notes: runMarker,
      idempotencyKey: `${runMarker}:dispatch`,
      expectedSourceVersion: 5,
      expectedTransitVersion: transit.stockVersion,
    };
    const dispatch = await dispatchStockTransfer(owner, dispatchInput);
    expect(dispatch).toMatchObject({ replayed: false, sourceStockVersion: 6, transitStockVersion: 2 });
    await expect(dispatchStockTransfer(owner, dispatchInput)).resolves.toMatchObject({
      stockDocumentId: dispatch.stockDocumentId,
      replayed: true,
    });
    await expect(dispatchStockTransfer(owner, {
      ...dispatchInput,
      notes: `${dispatchInput.notes}-changed`,
    })).rejects.toMatchObject({ failure: { code: 'idempotency_conflict' } });

    const receiptInput = {
      stockDocumentId: dispatch.stockDocumentId,
      destinationLocationId: salesPoint.id,
      lines: [{ inventoryItemId: finished.id, quantity: 2 }],
      discrepancies: [],
      occurredAt: at(6),
      notes: runMarker,
      idempotencyKey: `${runMarker}:receive-transfer`,
      expectedTransitVersion: 2,
      expectedDestinationVersion: salesPoint.stockVersion,
      expectedDocumentVersion: 1,
    };
    const receipt = await receiveStockTransfer(manager, receiptInput);
    expect(receipt).toMatchObject({
      replayed: false,
      dispatchStatus: 'RECEIVED',
      transitStockVersion: 3,
      destinationStockVersion: 2,
    });
    await expect(receiveStockTransfer(manager, receiptInput)).resolves.toMatchObject({
      receiptDocumentId: receipt.receiptDocumentId,
      replayed: true,
    });
    await expect(receiveStockTransfer(manager, {
      ...receiptInput,
      notes: `${receiptInput.notes}-changed`,
    })).rejects.toMatchObject({ failure: { code: 'idempotency_conflict' } });

    const [productionAvailability, salesAvailability] = await Promise.all([
      availability(finished.id, production.id),
      availability(finished.id, salesPoint.id),
    ]);
    expect(productionAvailability).toMatchObject({ onHand: 2, reserved: 0, available: 2 });
    expect(salesAvailability).toMatchObject({ onHand: 2, reserved: 0, available: 2 });
    expect(await movementBalance(finished.id, transit.id)).toBe(0);
    expect(await movementBalance(finished.id, quarantine.id)).toBe(0);

    const movedLots = await prisma.stockMovement.findMany({
      where: {
        inventoryItemId: finished.id,
        stockDocumentId: { in: [dispatch.stockDocumentId, receipt.receiptDocumentId] },
      },
      select: { costLayerId: true },
    });
    expect(new Set(movedLots.map((movement) => movement.costLayerId))).toEqual(new Set([outputLotId]));

    const failedKey = `${runMarker}:pack-insufficient`;
    const beforeFailureVersion = await locationVersion(production.id);
    const beforeDocumentCount = await prisma.stockDocument.count();
    await expect(packFinishedGoods(owner, {
      ...packInput,
      outputQuantity: 1,
      packedAt: at(7),
      idempotencyKey: failedKey,
      expectedLocationVersion: beforeFailureVersion,
    })).rejects.toMatchObject({ failure: { stage: 'pack_finished_goods' } });
    expect(await locationVersion(production.id)).toBe(beforeFailureVersion);
    expect(await prisma.stockDocument.count()).toBe(beforeDocumentCount);
    expect(await prisma.stockDocument.findUnique({ where: { idempotencyKey: failedKey } })).toBeNull();
  }, remoteIntegrationTimeout);

  it('reserves and sells only local finished stock with exact COGS and customer details', async () => {
    const pending = await createOrderFromInput({
      locale: 'en',
      placedAt: at(8),
      newCustomer: {
        nameEn: `Pending customer ${runId}`,
        phone: fixturePhone(1),
        governorate: 'BAGHDAD',
        address1: `District ${runId}`,
        street: 'Street 12, building 4',
        notes: 'Call before delivery',
        segment: 'NEW',
      },
      customerExternalId: null,
      customerEnrichment: null,
      channel: 'POS',
      governorate: 'BAGHDAD',
      fulfillmentMethod: 'BRANCH_SALE',
      fulfillmentLocationId: salesPoint.id,
      expectedLocationVersion: 2,
      status: 'PENDING',
      deliveryFee: 0,
      deliveryCost: 0,
      orderDiscount: 0,
      extraCharges: 0,
      notes: runMarker,
      financeMode: 'NONE',
      financeAccountId: null,
      financeProviderId: null,
      financePaidAmount: null,
      financePaymentMethod: null,
      financePaymentDate: null,
      financeDueDate: null,
      lines: [{
        sku: product.sku,
        quantity: 1,
        unitGrossPrice: product.sellingPrice,
        lineDiscount: 0,
      }],
    }, { actorContext: createTrustedCommandContext(manager) });
    expect(pending).toMatchObject({ ok: true });

    const afterReservation = await availability(finished.id, salesPoint.id);
    expect(afterReservation).toMatchObject({ onHand: 2, reserved: 1, available: 1, stockVersion: 3 });

    const completed = await createOrderFromInput({
      locale: 'en',
      placedAt: at(9),
      newCustomer: {
        nameEn: `Completed customer ${runId}`,
        nameAr: `عميل ${runId}`,
        phone: fixturePhone(2),
        email: `${runMarker}-customer@example.invalid`,
        governorate: 'BAGHDAD',
        address1: `Karrada ${runId}`,
        street: 'Lane 3, house 8',
        notes: 'Complete customer fixture',
        campaignSource: 'Inventory V2 integration',
        segment: 'NEW',
      },
      customerExternalId: null,
      customerEnrichment: null,
      channel: 'POS',
      governorate: 'BAGHDAD',
      fulfillmentMethod: 'BRANCH_SALE',
      fulfillmentLocationId: salesPoint.id,
      expectedLocationVersion: 3,
      status: 'COMPLETED',
      deliveryFee: 0,
      deliveryCost: 0,
      orderDiscount: 0,
      extraCharges: 0,
      notes: runMarker,
      financeMode: 'PAID',
      financeAccountId: salesAccountId,
      financeProviderId: null,
      financePaidAmount: null,
      financePaymentMethod: 'CASH',
      financePaymentDate: at(9),
      financeDueDate: null,
      lines: [{
        sku: product.sku,
        quantity: 1,
        unitGrossPrice: product.sellingPrice,
        lineDiscount: 0,
      }],
    }, { actorContext: createTrustedCommandContext(manager) });
    if (!completed?.ok || !completed.recordId) {
      throw new Error(`completed_order_failed:${JSON.stringify(completed)}`);
    }
    completedOrderId = completed.recordId;

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: completedOrderId },
      include: { customer: true, lines: true },
    });
    completedOrderLineId = order.lines[0].id;
    expect(order).toMatchObject({
      branchId,
      fulfillmentLocationId: salesPoint.id,
      status: 'COMPLETED',
      customer: {
        nameEn: `Completed customer ${runId}`,
        nameAr: `عميل ${runId}`,
        governorate: 'BAGHDAD',
        address1: `Karrada ${runId}`,
        street: 'Lane 3, house 8',
        notes: 'Complete customer fixture',
      },
    });
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({ unitCogsSnapshot: 3_250, cogsTotalSnapshot: 3_250 });

    const saleMovements = await prisma.stockMovement.findMany({
      where: { orderId: completedOrderId, reason: 'SOLD' },
      select: { quantity: true, locationId: true, costLayerId: true },
    });
    expect(saleMovements).toHaveLength(1);
    expect(saleMovements[0]).toMatchObject({ locationId: salesPoint.id, costLayerId: outputLotId });
    expect(Number(saleMovements[0].quantity)).toBe(-1);

    const finalAvailability = await availability(finished.id, salesPoint.id);
    expect(finalAvailability).toMatchObject({ onHand: 1, reserved: 1, available: 0, stockVersion: 4 });
    const payment = await prisma.financeEntry.findFirst({
      where: { orderId: completedOrderId, archivedAt: null },
      select: { accountId: true, stockLocationId: true, amount: true },
    });
    expect(payment).toMatchObject({
      accountId: salesAccountId,
      stockLocationId: salesPoint.id,
      amount: product.sellingPrice,
    });
  }, remoteIntegrationTimeout);

  it('quarantines and restocks a return, blocks cross-location writes, and reverses an unused receipt once', async () => {
    const returnInput = {
      orderLineId: completedOrderLineId,
      quantity: 1,
      occurredAt: at(10),
      reason: `Customer return ${runMarker}`,
      idempotencyKey: `${runMarker}:return`,
      expectedFulfillmentVersion: 4,
      expectedQuarantineVersion: quarantine.stockVersion,
    };
    const returned = await returnFinishedGoodsToQuarantine(manager, returnInput);
    expect(returned).toMatchObject({ replayed: false, stockVersion: 2 });
    await expect(returnFinishedGoodsToQuarantine(manager, returnInput)).resolves.toMatchObject({
      stockDocumentId: returned.stockDocumentId,
      replayed: true,
    });
    await expect(returnFinishedGoodsToQuarantine(manager, {
      ...returnInput,
      reason: `${returnInput.reason} changed`,
    })).rejects.toMatchObject({ failure: { code: 'idempotency_conflict' } });
    expect(await movementBalance(finished.id, quarantine.id)).toBe(1);

    const dispositionInput = {
      returnDocumentId: returned.stockDocumentId,
      inventoryItemId: finished.id,
      quantity: 1,
      disposition: 'RESTOCK' as const,
      destinationLocationId: salesPoint.id,
      occurredAt: at(11),
      reason: `Approved restock ${runMarker}`,
      idempotencyKey: `${runMarker}:restock-return`,
      expectedQuarantineVersion: 2,
      expectedDestinationVersion: 4,
      expectedReturnDocumentVersion: 1,
    };
    const disposition = await disposeReturnedGoods(owner, dispositionInput);
    expect(disposition).toMatchObject({
      replayed: false,
      disposition: 'RESTOCK',
      quarantineStockVersion: 3,
      destinationStockVersion: 5,
      returnDocumentVersion: 2,
      totalCost: 3_249.95,
    });
    await expect(disposeReturnedGoods(owner, dispositionInput)).resolves.toMatchObject({
      stockDocumentId: disposition.stockDocumentId,
      replayed: true,
    });
    await expect(disposeReturnedGoods(owner, {
      ...dispositionInput,
      reason: `${dispositionInput.reason} changed`,
    })).rejects.toMatchObject({ failure: { code: 'idempotency_conflict' } });
    expect(await availability(finished.id, salesPoint.id)).toMatchObject({
      onHand: 2,
      reserved: 1,
      available: 1,
      stockVersion: 5,
    });
    expect(await movementBalance(finished.id, quarantine.id)).toBe(0);

    const forbiddenKey = `${runMarker}:forbidden-dispatch`;
    const beforeForbiddenCount = await prisma.stockDocument.count();
    await expect(dispatchStockTransfer(manager, {
      sourceLocationId: production.id,
      destinationLocationId: salesPoint.id,
      lines: [{ inventoryItemId: finished.id, quantity: 1 }],
      occurredAt: at(12),
      idempotencyKey: forbiddenKey,
      expectedSourceVersion: await locationVersion(production.id),
      expectedTransitVersion: await locationVersion(transit.id),
    })).rejects.toMatchObject({ failure: { code: 'location_forbidden' } });
    expect(await prisma.stockDocument.count()).toBe(beforeForbiddenCount);
    expect(await prisma.stockDocument.findUnique({ where: { idempotencyKey: forbiddenKey } })).toBeNull();

    const extraReceiptInput = {
      inventoryItemId: packaging.id,
      locationId: production.id,
      quantity: 2,
      unitCost: 600,
      occurredAt: at(13),
      reference: `REVERSIBLE-${runId}`,
      paymentMode: 'CREDIT' as const,
      newSupplier: { name: `Reversal supplier ${runId}` },
      idempotencyKey: `${runMarker}:reversible-receipt`,
      expectedLocationVersion: await locationVersion(production.id),
    };
    const extraReceipt = await receivePurchasedStock(owner, extraReceiptInput);
    const versionBeforeReversal = await locationVersion(production.id);
    const reversalInput = {
      stockDocumentId: extraReceipt.stockDocumentId,
      confirmationDocumentNumber: extraReceipt.documentNumber,
      reason: `Integration reversal ${runMarker}`,
      occurredAt: at(14),
      idempotencyKey: `${runMarker}:reverse-receipt`,
      expectedDocumentVersion: 1,
      expectedLocationVersions: [{
        locationId: production.id,
        stockVersion: versionBeforeReversal,
      }],
    };
    const reversed = await reverseStockDocument(owner, reversalInput);
    expect(reversed).toMatchObject({ replayed: false, stockDocumentId: extraReceipt.stockDocumentId });
    await expect(reverseStockDocument(owner, reversalInput)).resolves.toMatchObject({
      reversalDocumentId: reversed.reversalDocumentId,
      replayed: true,
    });
    await expect(reverseStockDocument(owner, {
      ...reversalInput,
      reason: `${reversalInput.reason} changed`,
    })).rejects.toMatchObject({ failure: { code: 'idempotency_conflict' } });
    expect(await prisma.stockDocument.findUniqueOrThrow({
      where: { id: extraReceipt.stockDocumentId },
      select: { status: true },
    })).toMatchObject({ status: 'REVERSED' });
    expect(await movementBalance(packaging.id, production.id)).toBe(6);
    expect(await prisma.stockDocument.count({
      where: { idempotencyKey: reversalInput.idempotencyKey },
    })).toBe(1);
  }, remoteIntegrationTimeout);

  it('serializes simultaneous exact and conflicting command retries without duplicate writes', async () => {
    const exactKey = `${runMarker}:concurrent-exact`;
    const exactInput = {
      inventoryItemId: packaging.id,
      locationId: production.id,
      quantity: 1,
      unitCost: 700,
      occurredAt: at(15),
      reference: `CONCURRENT-EXACT-${runId}`,
      paymentMode: 'CREDIT' as const,
      newSupplier: { name: `Concurrent supplier ${runId}` },
      idempotencyKey: exactKey,
      expectedLocationVersion: await locationVersion(production.id),
    };
    const exactResults = await Promise.all([
      receivePurchasedStock(owner, exactInput),
      receivePurchasedStock(owner, exactInput),
    ]);
    expect(exactResults.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(new Set(exactResults.map((result) => result.stockDocumentId)).size).toBe(1);
    expect(await prisma.stockDocument.count({ where: { idempotencyKey: exactKey } })).toBe(1);
    expect(await prisma.stockMovement.count({ where: { externalId: `inventory-v2:${exactKey}:movement` } })).toBe(1);

    const conflictingKey = `${runMarker}:concurrent-conflict`;
    const conflictingBase = {
      ...exactInput,
      occurredAt: at(16),
      reference: `CONCURRENT-CONFLICT-${runId}`,
      idempotencyKey: conflictingKey,
      expectedLocationVersion: await locationVersion(production.id),
    };
    const conflictingResults = await Promise.allSettled([
      receivePurchasedStock(owner, { ...conflictingBase, quantity: 1 }),
      receivePurchasedStock(owner, { ...conflictingBase, quantity: 2 }),
    ]);
    expect(conflictingResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = conflictingResults.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { failure: { code: 'idempotency_conflict' } },
    });
    expect(await prisma.stockDocument.count({ where: { idempotencyKey: conflictingKey } })).toBe(1);
    expect(await prisma.stockMovement.count({
      where: { externalId: `inventory-v2:${conflictingKey}:movement` },
    })).toBe(1);
  }, remoteIntegrationTimeout);

  it('binds count, replenishment, expense, and discrepancy reviews to their original commands', async () => {
    const countInput = {
      locationId: salesPoint.id,
      kind: 'ROUTINE' as const,
      countedAt: at(17),
      reason: `Routine count ${runMarker}`,
      openingAttestation: false,
      lines: [{
        inventoryItemId: finished.id,
        countedQuantity: await movementBalance(finished.id, salesPoint.id),
      }],
      idempotencyKey: `${runMarker}:count`,
      expectedLocationVersion: await locationVersion(salesPoint.id),
    };
    const count = await submitInventoryCount(manager, countInput);
    await expect(submitInventoryCount(manager, countInput)).resolves.toMatchObject({
      inventoryCountId: count.inventoryCountId,
      replayed: true,
    });
    await expect(submitInventoryCount(manager, {
      ...countInput,
      reason: `${countInput.reason} changed`,
    })).rejects.toMatchObject({ failure: { code: 'idempotency_conflict' } });

    const countRejectInput = {
      inventoryCountId: count.inventoryCountId,
      reason: `Count evidence rejected ${runMarker}`,
      idempotencyKey: `${runMarker}:count-reject`,
      expectedCountVersion: 1,
    };
    await expect(rejectInventoryCount(owner, countRejectInput)).resolves.toMatchObject({ replayed: false });
    await expect(rejectInventoryCount(owner, countRejectInput)).resolves.toMatchObject({ replayed: true });
    await expect(rejectInventoryCount(owner, {
      ...countRejectInput,
      reason: `${countRejectInput.reason} changed`,
    })).rejects.toMatchObject({ failure: { code: 'idempotency_conflict' } });

    const replenishment = await prisma.stockReplenishmentRequest.create({
      data: {
        requestNumber: `LHB-RPL-${runId.toUpperCase()}-REVIEW`,
        inventoryItemId: finished.id,
        locationId: salesPoint.id,
        quantity: '1.000',
        status: 'OPEN',
        createdById: manager.id,
        notes: runMarker,
      },
    });
    const replenishInput = {
      replenishmentRequestId: replenishment.id,
      decision: 'START' as const,
      reason: `Central dispatch approved ${runMarker}`,
      idempotencyKey: `${runMarker}:replenishment-review`,
      expectedRequestVersion: 1,
    };
    await expect(reviewReplenishmentRequest(owner, replenishInput)).resolves.toMatchObject({
      status: 'IN_PROGRESS',
      replayed: false,
    });
    await expect(reviewReplenishmentRequest(owner, replenishInput)).resolves.toMatchObject({ replayed: true });
    await expect(reviewReplenishmentRequest(owner, {
      ...replenishInput,
      reason: `${replenishInput.reason} changed`,
    })).rejects.toMatchObject({ failure: { code: 'idempotency_conflict' } });

    await prisma.locationExpensePolicy.upsert({
      where: { locationId: salesPoint.id },
      create: {
        locationId: salesPoint.id,
        isActive: true,
        allowedCategories: ['SHIPPING'],
        maxImmediateAmount: 0,
        receiptRequiredAbove: 0,
      },
      update: {
        isActive: true,
        allowedCategories: ['SHIPPING'],
        maxImmediateAmount: 0,
        receiptRequiredAbove: 0,
      },
    });
    const expenseInput = {
      locationId: salesPoint.id,
      amount: 5_000,
      categoryType: 'SHIPPING' as const,
      description: `Local delivery ${runMarker}`,
      occurredAt: at(18),
      noReceiptReason: 'Courier did not provide a receipt',
      idempotencyKey: `${runMarker}:local-expense`,
      expectedLocationVersion: await locationVersion(salesPoint.id),
    };
    const expense = await recordLocalExpense(manager, expenseInput);
    expect(expense).toMatchObject({ status: 'SUBMITTED', replayed: false, financeEntryId: null });
    await expect(recordLocalExpense(manager, expenseInput)).resolves.toMatchObject({ replayed: true });
    await expect(recordLocalExpense(manager, {
      ...expenseInput,
      description: `${expenseInput.description} changed`,
    })).rejects.toMatchObject({ failure: { code: 'idempotency_conflict' } });

    const expenseReviewInput = {
      requestId: expense.requestId,
      decision: 'APPROVE' as const,
      reason: `Exception approved ${runMarker}`,
      occurredAt: at(19),
      idempotencyKey: `${runMarker}:local-expense-review`,
      expectedRequestVersion: 1,
      expectedLocationVersion: await locationVersion(salesPoint.id),
    };
    await expect(reviewLocalExpense(owner, expenseReviewInput)).resolves.toMatchObject({
      status: 'POSTED',
      replayed: false,
    });
    await expect(reviewLocalExpense(owner, expenseReviewInput)).resolves.toMatchObject({ replayed: true });
    await expect(reviewLocalExpense(owner, {
      ...expenseReviewInput,
      reason: `${expenseReviewInput.reason} changed`,
    })).rejects.toMatchObject({ failure: { code: 'idempotency_conflict' } });

    await prisma.inventoryVariancePolicy.upsert({
      where: { locationId: production.id },
      create: {
        locationId: production.id,
        isActive: true,
        openingBalanceAccountCode: 'INVENTORY_OPENING',
        inventoryGainAccountCode: 'INVENTORY_GAIN',
        inventoryLossAccountCode: 'INVENTORY_LOSS',
      },
      update: {
        isActive: true,
        openingBalanceAccountCode: 'INVENTORY_OPENING',
        inventoryGainAccountCode: 'INVENTORY_GAIN',
        inventoryLossAccountCode: 'INVENTORY_LOSS',
      },
    });
    const discrepancy = await prisma.stockDiscrepancy.create({
      data: {
        stockDocumentId: roastDocumentId,
        inventoryItemId: green.id,
        type: 'DAMAGE',
        quantity: '1.000',
        reportedUnitCost: '10.000',
        stockEffectPending: false,
        notes: `Valuation-only roast discrepancy ${runMarker}`,
        reportedById: owner.id,
      },
    });
    const discrepancyInput = {
      stockDiscrepancyId: discrepancy.id,
      decision: 'APPROVE' as const,
      resolution: `Roast loss approved ${runMarker}`,
      occurredAt: at(20),
      idempotencyKey: `${runMarker}:discrepancy-review`,
      expectedDiscrepancyVersion: 1,
      expectedLocationVersion: await locationVersion(production.id),
    };
    await expect(resolveStockDiscrepancy(owner, discrepancyInput)).resolves.toMatchObject({
      status: 'RESOLVED',
      replayed: false,
    });
    await expect(resolveStockDiscrepancy(owner, discrepancyInput)).resolves.toMatchObject({ replayed: true });
    await expect(resolveStockDiscrepancy(owner, {
      ...discrepancyInput,
      resolution: `${discrepancyInput.resolution} changed`,
    })).rejects.toMatchObject({ failure: { code: 'idempotency_conflict' } });
  }, remoteIntegrationTimeout);
});
