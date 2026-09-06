import { randomInt, randomUUID } from 'node:crypto';
import type { AiPendingActionRisk, AiPendingActionType, Prisma } from '@prisma/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => unknown>(callback: T) => callback,
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/server/auth/session', () => ({ getCurrentUser: vi.fn(async () => null) }));
vi.mock('@/server/telegram/api', () => ({
  sendTelegramDocument: vi.fn(async () => ({ message_id: 93001 })),
}));

import { createDashboardConfig } from '@/lib/dashboard-builder';
import { formatProductBarcode, formatRetailBarcode } from '@/lib/barcode';
import type { CurrentUser } from '@/server/auth/session';
import { confirmPendingAction } from '@/server/ai/actions';
import {
  ResolvedCustomerActionSchema,
  ResolvedCustomerUpdateActionSchema,
  ResolvedDashboardDraftActionSchema,
  ResolvedInventoryAdjustmentActionSchema,
  ResolvedOrderActionSchema,
  ResolvedOrderStatusActionSchema,
  ResolvedPartyActionSchema,
  ResolvedPartyUpdateActionSchema,
  ResolvedPaymentActionSchema,
  ResolvedPurchaseActionSchema,
  ResolvedRefundActionSchema,
  ResolvedReversalActionSchema,
  ResolvedRoastBatchActionSchema,
  ResolvedSpendReclassificationActionSchema,
  ResolvedTransferActionSchema,
} from '@/server/ai/action-data';
import { createPendingAction } from '@/server/ai/pending';
import { actionPreconditionIssues, loadActionPreconditions } from '@/server/ai/preconditions';
import { createTrustedCommandContext } from '@/server/commands/actor-context';
import { prisma } from '@/server/db/client';
import { createCentralRecordFromInput } from '@/server/finance/central-records';
import { createOrderFromInput } from '@/server/records/orders';
import { resetAiCapabilitiesForIntegration } from './fixtures/ai-phase2-database';

const integrationEnabled = process.env.AI_PHASE2_INTEGRATION === '1';
const describeIntegration = integrationEnabled ? describe.sequential : describe.skip;
const remoteIntegrationTimeout = 120_000;
const runMarker = `phase2-ops-${randomUUID().slice(0, 8)}`;
const phoneSeed = randomInt(0, 9_000_000);
let phoneCounter = 0;

function nextPhone(): string {
  phoneCounter += 1;
  return `+964781${String((phoneSeed + phoneCounter) % 10_000_000).padStart(7, '0')}`;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function assertSafeIntegrationDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  const localhost = /(?:localhost|127\.0\.0\.1):\d+/.test(url);
  if (!localhost && process.env.AI_PHASE2_DATABASE_ISOLATED !== 'true') {
    throw new Error('ai_phase2_integration_requires_isolated_database');
  }
}

async function createFixtureUser(branchId: string, defaultFinanceAccountId: string): Promise<CurrentUser> {
  const id = randomUUID();
  return prisma.user.create({
    data: {
      email: `${runMarker}-${id.slice(0, 6)}@example.invalid`,
      name: 'Phase 2 Operations Owner',
      role: 'OWNER',
      hashedPassword: 'phase-2-operations-user-not-for-login',
      branchId,
      defaultFinanceAccountId,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      branchId: true,
      defaultFinanceAccountId: true,
    },
  });
}

async function createPendingFixture(input: {
  type: AiPendingActionType;
  validatedData: unknown;
  user: CurrentUser;
  risk?: AiPendingActionRisk;
  confirmationChallenge?: string;
}) {
  const conversation = await prisma.aiConversation.create({
    data: {
      userId: input.user.id,
      locale: 'en',
      channel: 'WEB',
      expiresAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  const preconditions = await loadActionPreconditions(input.type, input.validatedData);
  expect(actionPreconditionIssues(input.type, input.validatedData, preconditions)).toEqual([]);
  return createPendingAction({
    conversationId: conversation.id,
    userId: input.user.id,
    type: input.type,
    risk: input.risk,
    confirmationChallenge: input.confirmationChallenge,
    extractedData: jsonValue(input.validatedData),
    validatedData: jsonValue(input.validatedData),
    preconditions,
    preview: {
      type: input.type,
      title: `${runMarker} preview`,
      summary: `${runMarker} summary`,
      fields: [{ label: 'Fixture', value: runMarker }],
      warnings: [],
    },
  });
}

async function expectReadyPdf(documentId: string | undefined, recordId: string): Promise<void> {
  expect(documentId).toBeTruthy();
  const document = await prisma.aiDocument.findUniqueOrThrow({ where: { id: documentId } });
  expect(document).toMatchObject({
    recordId,
    status: 'READY',
    mimeType: 'application/pdf',
  });
  expect(document.byteSize).toBeGreaterThan(1_000);
  expect(Buffer.from(document.content ?? []).subarray(0, 4).toString('ascii')).toBe('%PDF');
  expect(document.checksum).toMatch(/^[a-f0-9]{64}$/);
}

async function confirmFixture(input: {
  type: AiPendingActionType;
  validatedData: unknown;
  user: CurrentUser;
  challenge?: string;
}) {
  const action = await createPendingFixture({
    type: input.type,
    validatedData: input.validatedData,
    user: input.user,
    risk: input.challenge ? 'HIGH' : 'MEDIUM',
    confirmationChallenge: input.challenge,
  });
  let result = await confirmPendingAction({ actionId: action.id, user: input.user, locale: 'en' });
  if (input.challenge) {
    expect(result).toMatchObject({
      status: 'PENDING',
      committed: false,
      requiresSecondConfirmation: true,
      confirmationChallenge: input.challenge,
    });
    expect(await prisma.aiExecutionReceipt.count({ where: { pendingActionId: action.id } })).toBe(0);
    result = await confirmPendingAction({
      actionId: action.id,
      user: input.user,
      locale: 'en',
      confirmationText: input.challenge,
    });
  }
  expect(result).toMatchObject({ status: 'EXECUTED', committed: true, documentStatus: 'READY' });
  expect(result.recordId).toBeTruthy();
  await expectReadyPdf(result.documentId, result.recordId as string);

  const replay = await confirmPendingAction({ actionId: action.id, user: input.user, locale: 'en' });
  expect(replay).toMatchObject({
    status: 'EXECUTED',
    recordId: result.recordId,
    documentId: result.documentId,
    replayed: true,
  });
  const receipt = await prisma.aiExecutionReceipt.findUniqueOrThrow({
    where: { pendingActionId: action.id },
    include: { documents: true },
  });
  expect(receipt).toMatchObject({
    actionType: input.type,
    userId: input.user.id,
    recordId: result.recordId,
    status: 'COMPLETED',
  });
  expect(receipt.documents).toHaveLength(1);
  expect(receipt.auditLogId).toBeTruthy();
  const audit = await prisma.auditLog.findUniqueOrThrow({ where: { id: receipt.auditLogId as string } });
  expect(audit).toMatchObject({
    userId: input.user.id,
    action: 'AI_ACTION_EXECUTED',
    entityId: result.recordId,
  });
  return { action, result };
}

function customerDetails(name: string, phone: string) {
  return ResolvedCustomerActionSchema.parse({
    nameEn: name,
    nameAr: `عميل ${runMarker}`,
    phone,
    email: `${runMarker}@example.invalid`,
    governorate: 'BAGHDAD',
    address1: `District ${runMarker}`,
    street: 'Street 21, building 8',
    notes: 'Complete customer fixture',
    campaignSource: 'Phase 2 operations',
    segment: 'NEW',
  });
}

function orderFixture(input: {
  product: { id: string; sku: string; price: number };
  name: string;
  phone: string;
}) {
  return ResolvedOrderActionSchema.parse({
    customerExternalId: null,
    newCustomer: customerDetails(input.name, input.phone),
    customerEnrichment: null,
    placedAt: new Date().toISOString(),
    channel: 'POS',
    governorate: 'BAGHDAD',
    fulfillmentMethod: 'PICKUP',
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
      productId: input.product.id,
      sku: input.product.sku,
      quantity: 2,
      unitGrossPrice: input.product.price,
      lineDiscount: 0,
    }],
  });
}

function orderCommandInput(input: ReturnType<typeof orderFixture>) {
  return {
    locale: 'en' as const,
    ...input,
    lines: input.lines.map(({ sku, quantity, unitGrossPrice, lineDiscount }) => ({
      sku,
      quantity,
      unitGrossPrice,
      lineDiscount,
    })),
  };
}

async function currentQuantity(inventoryItemId: string): Promise<number> {
  const movements = await prisma.stockMovement.findMany({
    where: { inventoryItemId },
    select: { quantity: true },
  });
  return movements.reduce((sum, row) => sum + Number(row.quantity), 0);
}

describeIntegration('AI Assistant Phase 2 governed operations', { timeout: remoteIntegrationTimeout }, () => {
  let branchId: string;
  let owner: CurrentUser;
  let accountId: string;
  let secondAccountId: string;
  let product: { id: string; sku: string; price: number };
  let productInventoryItemId: string;
  let greenInventoryItemId: string;
  let roastedInventoryItemId: string;

  beforeAll(async () => {
    assertSafeIntegrationDatabase();
    await resetAiCapabilitiesForIntegration();
    const branch = await prisma.branch.findFirstOrThrow({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
    branchId = branch.id;
    const [account, secondAccount] = await Promise.all([
      prisma.financeAccount.create({
        data: { name: `${runMarker} cash`, type: 'CASH', branchId, currency: 'IQD' },
      }),
      prisma.financeAccount.create({
        data: { name: `${runMarker} bank`, type: 'BANK', currency: 'IQD' },
      }),
    ]);
    accountId = account.id;
    secondAccountId = secondAccount.id;
    owner = await createFixtureUser(branchId, accountId);

    const barcodeSequence = randomInt(100_000_000, 999_999_999);
    const productRow = await prisma.product.create({
      data: {
        sku: `${runMarker}-SKU`,
        barcodeValue: formatProductBarcode(barcodeSequence),
        retailBarcode: formatRetailBarcode(barcodeSequence),
        nameEn: `${runMarker} product`,
        nameAr: `منتج ${runMarker}`,
        productLine: 'ACCESSORIES',
        sizeLabel: '1 unit',
        sellingPrice: 12_000,
        cogsPerUnit: 4_000,
      },
    });
    product = { id: productRow.id, sku: productRow.sku, price: productRow.sellingPrice };
    const productItem = await prisma.inventoryItem.create({
      data: {
        nameEn: `${runMarker} finished stock`,
        nameAr: `مخزون ${runMarker}`,
        category: 'ACCESSORY',
        unit: 'unit',
        unitCost: 4_000,
        productId: productRow.id,
        branchId,
      },
    });
    productInventoryItemId = productItem.id;
    const green = await prisma.inventoryItem.create({
      data: {
        nameEn: `${runMarker} green coffee`,
        nameAr: `بن أخضر ${runMarker}`,
        category: 'GREEN_COFFEE',
        unit: 'g',
        unitCost: 20,
        branchId,
      },
    });
    greenInventoryItemId = green.id;
    const roasted = await prisma.inventoryItem.create({
      data: {
        nameEn: `${runMarker} roasted coffee`,
        nameAr: `بن محمص ${runMarker}`,
        category: 'ROASTED',
        unit: 'g',
        unitCost: 0,
        branchId,
      },
    });
    roastedInventoryItemId = roasted.id;
    const openingAt = new Date();
    await prisma.$transaction([
      prisma.stockMovement.createMany({
        data: [
          {
            inventoryItemId: productItem.id,
            occurredAt: openingAt,
            reason: 'OPENING',
            quantity: 100,
            reference: runMarker,
            branchId,
          },
          {
            inventoryItemId: green.id,
            occurredAt: openingAt,
            reason: 'OPENING',
            quantity: 5_000,
            reference: runMarker,
            branchId,
          },
        ],
      }),
      prisma.inventoryCostLayer.createMany({
        data: [
          {
            inventoryItemId: productItem.id,
            qtyReceived: 100,
            unitCost: 4_000,
            receivedAt: openingAt,
          },
          {
            inventoryItemId: green.id,
            qtyReceived: 5_000,
            unitCost: 20,
            receivedAt: openingAt,
          },
        ],
      }),
    ]);
  });

  it('creates and updates a complete customer with one receipt and PDF per action', async () => {
    const phone = nextPhone();
    const created = await confirmFixture({
      type: 'CREATE_CUSTOMER',
      validatedData: customerDetails('Phase Operations Customer', phone),
      user: owner,
    });
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: created.result.recordId } });
    expect(customer).toMatchObject({
      nameEn: 'Phase Operations Customer',
      phone,
      normalizedPhone: phone,
      governorate: 'BAGHDAD',
      address1: `District ${runMarker}`,
      street: 'Street 21, building 8',
      notes: 'Complete customer fixture',
      campaignSource: 'Phase 2 operations',
    });

    const update = ResolvedCustomerUpdateActionSchema.parse({
      customerId: customer.id,
      externalId: customer.externalId,
      nameEn: 'Phase Operations Customer Updated',
      address1: `Updated district ${runMarker}`,
      street: 'Updated street 4',
      notes: 'Updated through governed AI action',
      reason: 'Customer supplied corrected delivery details',
    });
    await confirmFixture({ type: 'UPDATE_CUSTOMER', validatedData: update, user: owner });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).toMatchObject({
      nameEn: 'Phase Operations Customer Updated',
      phone,
      address1: `Updated district ${runMarker}`,
      street: 'Updated street 4',
      notes: 'Updated through governed AI action',
    });
  });

  it('records an atomic partial inventory purchase, updates its supplier, and preserves payable and stock effects', async () => {
    const supplierPhone = nextPhone();
    const reference = `${runMarker}-purchase`;
    const purchase = ResolvedPurchaseActionSchema.parse({
      purchaseType: 'INVENTORY',
      date: new Date().toISOString(),
      totalAmount: 23_750,
      currency: 'IQD',
      rate: null,
      quantity: 2.375,
      unit: 'kg',
      inventoryItemId: null,
      newItemNameEn: `${runMarker} purchased beans`,
      newItemNameAr: `بن مشترى ${runMarker}`,
      newItemCategory: 'GREEN_COFFEE',
      assetName: null,
      assetCategory: null,
      supplierId: null,
      newSupplier: ResolvedPartyActionSchema.parse({
        name: `${runMarker} supplier`,
        type: 'SUPPLIER',
        phone: supplierPhone,
        email: `${runMarker}-supplier@example.invalid`,
        address: `Supplier address ${runMarker}`,
        branchId,
        notes: 'Created atomically with purchase',
      }),
      paidMode: 'PARTIAL',
      paidAmount: 8_750,
      accountId,
      paymentMethod: 'CASH',
      paymentDate: new Date().toISOString(),
      dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      branchId,
      reference,
      notes: 'Partial inventory purchase',
      lines: null,
    });
    const result = await confirmFixture({ type: 'CREATE_PURCHASE', validatedData: purchase, user: owner });
    const entry = await prisma.financeEntry.findUniqueOrThrow({
      where: { id: result.result.recordId },
      include: {
        party: true,
        settlements: true,
        stockMovements: true,
        costLayers: true,
        ledgerLines: true,
      },
    });
    expect(entry).toMatchObject({
      type: 'PURCHASE',
      recordClass: 'PURCHASE',
      amount: 23_750,
      obligation: true,
      obligationKind: 'PAYABLE',
      accountId: null,
      branchId,
      reference,
    });
    expect(entry.party).toMatchObject({
      name: `${runMarker} supplier`,
      type: 'SUPPLIER',
      phone: supplierPhone,
      address: `Supplier address ${runMarker}`,
    });
    expect(entry.settlements).toHaveLength(1);
    expect(entry.settlements[0]).toMatchObject({ amount: 8_750, type: 'PAYMENT_OUT', accountId });
    expect(entry.stockMovements).toHaveLength(1);
    expect(Number(entry.stockMovements[0].quantity)).toBe(2.375);
    expect(entry.costLayers).toHaveLength(1);
    expect(Number(entry.costLayers[0].qtyReceived)).toBe(2.375);
    expect(entry.ledgerLines).toHaveLength(1);
    expect(entry.ledgerLines[0]).toMatchObject({ spendTreatment: 'INVENTORY', classificationStatus: 'CONFIRMED' });

    const partyUpdate = ResolvedPartyUpdateActionSchema.parse({
      partyId: entry.partyId,
      partyName: entry.party?.name,
      phone: supplierPhone,
      address: `Updated supplier address ${runMarker}`,
      notes: 'Updated through governed AI action',
      reason: 'Supplier confirmed corrected address',
    });
    await confirmFixture({ type: 'UPDATE_PARTY', validatedData: partyUpdate, user: owner });
    expect(await prisma.party.findUniqueOrThrow({ where: { id: entry.partyId as string } })).toMatchObject({
      phone: supplierPhone,
      address: `Updated supplier address ${runMarker}`,
      notes: 'Updated through governed AI action',
    });
  });

  it('records a transfer once and reverses it only after the record-number challenge', async () => {
    const transfer = ResolvedTransferActionSchema.parse({
      date: new Date().toISOString(),
      amount: 12_345,
      currency: 'IQD',
      rate: null,
      fromAccountId: accountId,
      fromAccountName: `${runMarker} cash`,
      toAccountId: secondAccountId,
      toAccountName: `${runMarker} bank`,
      description: `Transfer ${runMarker}`,
      reference: `${runMarker}-transfer`,
    });
    const transferResult = await confirmFixture({ type: 'CREATE_TRANSFER', validatedData: transfer, user: owner });
    const entry = await prisma.financeEntry.findUniqueOrThrow({ where: { id: transferResult.result.recordId } });
    expect(entry).toMatchObject({
      type: 'TRANSFER',
      amount: 12_345,
      accountId,
      toAccountId: secondAccountId,
      createdById: owner.id,
    });

    const recordNumber = entry.recordKey ?? entry.id;
    const reversal = ResolvedReversalActionSchema.parse({
      financeEntryId: entry.id,
      recordNumber,
      reason: 'Phase 2 deliberate transfer reversal test',
    });
    await confirmFixture({
      type: 'REVERSE_RECORD',
      validatedData: reversal,
      user: owner,
      challenge: recordNumber,
    });
    const reversed = await prisma.financeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(reversed).toMatchObject({ reversedById: owner.id, reversalReason: 'Phase 2 deliberate transfer reversal test' });
    expect(reversed.reversedAt).toBeInstanceOf(Date);
    expect(await prisma.financeEntry.count({ where: { reversalOfId: entry.id } })).toBe(1);
  });

  it('adjusts inventory and records a synchronized roast batch with complete movement PDFs', async () => {
    const before = await currentQuantity(productInventoryItemId);
    const adjustment = ResolvedInventoryAdjustmentActionSchema.parse({
      inventoryItemId: productInventoryItemId,
      inventoryItemName: `${runMarker} finished stock`,
      targetQuantity: before + 1.125,
      occurredAt: new Date().toISOString(),
      reason: 'Phase 2 verified stock count',
    });
    await confirmFixture({ type: 'ADJUST_INVENTORY', validatedData: adjustment, user: owner });
    expect(await currentQuantity(productInventoryItemId)).toBe(before + 1.125);
    expect(await prisma.stockMovement.count({
      where: { inventoryItemId: productInventoryItemId, reason: 'ADJUSTMENT', reference: { contains: 'Phase 2 verified stock count' } },
    })).toBe(1);

    const batchNumber = `${runMarker}-BATCH`;
    const roast = ResolvedRoastBatchActionSchema.parse({
      batchNumber,
      origin: 'Ethiopia',
      roastDate: new Date().toISOString(),
      roastLevel: 'MEDIUM',
      greenInputGrams: 1_000,
      roastedOutputGrams: 820,
      qcScore: 86.5,
      qcNotes: 'Phase 2 batch verification',
      greenInventoryItemId,
      roastedInventoryItemId,
      branchId,
    });
    const greenBefore = await currentQuantity(greenInventoryItemId);
    const roastedBefore = await currentQuantity(roastedInventoryItemId);
    const result = await confirmFixture({ type: 'CREATE_ROAST_BATCH', validatedData: roast, user: owner });
    expect(await prisma.roastBatch.findUniqueOrThrow({ where: { id: result.result.recordId } })).toMatchObject({
      batchNumber,
      greenInputGrams: 1_000,
      roastedOutputGrams: 820,
      operatorId: owner.id,
      branchId,
    });
    expect(await currentQuantity(greenInventoryItemId)).toBe(greenBefore - 1_000);
    expect(await currentQuantity(roastedInventoryItemId)).toBe(roastedBefore + 820);
    expect(await prisma.stockMovement.count({ where: { roastBatchId: result.result.recordId } })).toBe(2);
    expect(await prisma.inventoryCostLayer.count({ where: { roastBatchId: result.result.recordId } })).toBe(1);
  });

  it('completes an unpaid order with one payment, stock, COGS, audit, and status-change PDF', async () => {
    const data = orderFixture({ product, name: 'Phase Status Customer', phone: nextPhone() });
    const created = await createOrderFromInput(orderCommandInput(data), {
      actorContext: createTrustedCommandContext(owner),
    });
    expect(created).toMatchObject({ ok: true });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: created?.recordId as string } });
    const stockBefore = await currentQuantity(productInventoryItemId);
    const update = ResolvedOrderStatusActionSchema.parse({
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: 'COMPLETED',
      completionMode: 'DIRECT',
      accountId,
      providerKey: null,
      paymentMethod: 'CASH',
      date: new Date().toISOString(),
    });
    await confirmFixture({ type: 'UPDATE_ORDER_STATUS', validatedData: update, user: owner });
    const completedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { lines: true },
    });
    expect(completedOrder).toMatchObject({ status: 'COMPLETED' });
    expect(completedOrder.lines).toHaveLength(1);
    expect(completedOrder.lines[0]).toMatchObject({ quantity: 2, unitCogsSnapshot: 4_000 });
    expect(await currentQuantity(productInventoryItemId)).toBe(stockBefore - 2);
    expect(await prisma.stockMovement.count({ where: { orderId: order.id, reason: 'SOLD' } })).toBe(1);
    const financeEntries = await prisma.financeEntry.findMany({
      where: { orderId: order.id, archivedAt: null, reversedAt: null, reversalOfId: null },
    });
    expect(financeEntries).toHaveLength(1);
    expect(financeEntries[0]).toMatchObject({
      type: 'INCOME',
      amount: product.price * 2,
      accountId,
      obligation: false,
    });
  });

  it('records and refunds an order payment with no duplicate finance mutation', async () => {
    const data = orderFixture({ product, name: 'Phase Payment Customer', phone: nextPhone() });
    const created = await createOrderFromInput(orderCommandInput(data), {
      actorContext: createTrustedCommandContext(owner),
    });
    expect(created).toMatchObject({ ok: true });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: created?.recordId as string } });
    const paymentAmount = 10_000;
    const payment = ResolvedPaymentActionSchema.parse({
      targetType: 'ORDER',
      targetId: order.id,
      targetNumber: order.orderNumber,
      amount: paymentAmount,
      accountId,
      accountName: `${runMarker} cash`,
      paymentMethod: 'CASH',
      date: new Date().toISOString(),
    });
    const paymentResult = await confirmFixture({ type: 'RECORD_PAYMENT', validatedData: payment, user: owner });
    expect(await prisma.financeEntry.findUniqueOrThrow({ where: { id: paymentResult.result.recordId } })).toMatchObject({
      type: 'PAYMENT_IN',
      amount: paymentAmount,
      accountId,
      orderId: order.id,
      createdById: owner.id,
    });

    const refundAmount = 4_000;
    const refund = ResolvedRefundActionSchema.parse({
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: refundAmount,
      accountId,
      accountName: `${runMarker} cash`,
      paymentMethod: 'CASH',
      date: new Date().toISOString(),
      reason: 'Phase 2 partial refund verification',
    });
    const refundResult = await confirmFixture({
      type: 'RECORD_REFUND',
      validatedData: refund,
      user: owner,
      challenge: order.orderNumber,
    });
    expect(await prisma.financeEntry.findUniqueOrThrow({ where: { id: refundResult.result.recordId } })).toMatchObject({
      type: 'PAYMENT_OUT',
      amount: refundAmount,
      accountId,
      orderId: order.id,
      createdById: owner.id,
    });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ refundAmount });
  });

  it('reclassifies a spend only after the record-number challenge and creates no duplicate allocation', async () => {
    const reference = `${runMarker}-reclassify`;
    const created = await createCentralRecordFromInput({
      locale: 'en',
      recordKind: 'MONEY_OUT',
      date: new Date().toISOString(),
      amount: 7_500,
      currency: 'IQD',
      accountId,
      categoryType: 'OVERHEAD',
      branchId,
      description: `Unclassified spend ${runMarker}`,
      reference,
    }, { actorContext: createTrustedCommandContext(owner) });
    expect(created).toMatchObject({ ok: true });
    const entry = await prisma.financeEntry.findUniqueOrThrow({
      where: { id: created?.recordId as string },
      include: { ledgerLines: true },
    });
    const line = entry.ledgerLines[0];
    expect(line).toBeTruthy();
    const recordNumber = entry.recordKey ?? entry.id;
    const reclassification = ResolvedSpendReclassificationActionSchema.parse({
      entryId: entry.id,
      recordNumber,
      lineId: line.id,
      lineName: line.itemName,
      spendTreatment: 'CAPEX',
      classificationNote: 'Owner confirmed this is durable equipment',
      fixedAssetId: null,
      inventoryItemId: null,
    });
    await confirmFixture({
      type: 'RECLASSIFY_SPEND',
      validatedData: reclassification,
      user: owner,
      challenge: recordNumber,
    });
    expect(await prisma.ledgerEntryLine.findUniqueOrThrow({ where: { id: line.id } })).toMatchObject({
      itemType: 'ASSET',
      spendTreatment: 'CAPEX',
      classificationStatus: 'CONFIRMED',
      classificationNote: 'Owner confirmed this is durable equipment',
    });
    expect(await prisma.fixedAssetCostAllocation.count({ where: { ledgerLineId: line.id } })).toBe(1);
    expect(await prisma.fixedAsset.count({ where: { financeEntryId: entry.id, isActive: true } })).toBe(1);
  });

  it('creates a private dashboard draft with a persisted-data PDF and trusted metric config', async () => {
    const dashboardName = `${runMarker} dashboard`;
    const config = createDashboardConfig(
      [{
        id: 'sales',
        type: 'kpi',
        title: 'Net sales',
        source: 'sales',
        metric: 'sales.netSales',
        hideFromPdf: false,
      }],
      [{ i: 'sales', x: 0, y: 0, w: 4, h: 2 }],
    );
    const draft = ResolvedDashboardDraftActionSchema.parse({
      name: dashboardName,
      description: 'Phase 2 trusted dashboard draft',
      config,
    });
    const result = await confirmFixture({ type: 'CREATE_DASHBOARD_DRAFT', validatedData: draft, user: owner });
    const dashboard = await prisma.dashboard.findUniqueOrThrow({ where: { id: result.result.recordId } });
    expect(dashboard).toMatchObject({
      name: dashboardName,
      description: 'Phase 2 trusted dashboard draft',
      ownerId: owner.id,
      visibility: 'PRIVATE',
    });
    expect(dashboard.config).toEqual(config);
    expect(dashboard.draftConfig).toEqual(config);
  });
});
