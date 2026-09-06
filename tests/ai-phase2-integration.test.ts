import { randomInt, randomUUID } from 'node:crypto';
import type { AiPendingActionType, Prisma } from '@prisma/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const sendTelegramDocument = vi.hoisted(() => vi.fn(async () => ({ message_id: 92001 })));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => unknown>(callback: T) => callback,
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/server/auth/session', () => ({ getCurrentUser: vi.fn(async () => null) }));
vi.mock('@/server/telegram/api', () => ({ sendTelegramDocument }));

import type { CurrentUser } from '@/server/auth/session';
import { createTrustedCommandContext } from '@/server/commands/actor-context';
import {
  CENTRAL_RECORD_TRANSACTION_CHECKPOINTS,
  ORDER_CREATE_TRANSACTION_CHECKPOINTS,
} from '@/server/commands/transaction-checkpoints';
import { prisma } from '@/server/db/client';
import { createCentralRecordFromInput } from '@/server/finance/central-records';
import { getInvoiceData } from '@/server/invoice/data';
import { createOrderFromInput } from '@/server/records/orders';
import { confirmPendingAction } from '@/server/ai/actions';
import {
  ResolvedExpenseActionSchema,
  ResolvedOrderActionSchema,
  ResolvedPartyActionSchema,
} from '@/server/ai/action-data';
import { createPendingAction } from '@/server/ai/pending';
import { actionPreconditionIssues, loadActionPreconditions } from '@/server/ai/preconditions';

const integrationEnabled = process.env.AI_PHASE2_INTEGRATION === '1';
const describeIntegration = integrationEnabled ? describe.sequential : describe.skip;
const remoteIntegrationTimeout = 120_000;
const runMarker = `phase2-${randomUUID().slice(0, 8)}`;
const phoneSeed = randomInt(0, 9_000_000);
let phoneCounter = 0;

function nextPhone(): string {
  phoneCounter += 1;
  return `+964770${String((phoneSeed + phoneCounter) % 10_000_000).padStart(7, '0')}`;
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

async function createFixtureUser(input: {
  role: CurrentUser['role'];
  branchId: string;
  defaultFinanceAccountId?: string | null;
}): Promise<CurrentUser> {
  const id = randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `${runMarker}-${id.slice(0, 6)}@example.invalid`,
      name: `Phase 2 ${input.role}`,
      role: input.role,
      hashedPassword: 'phase-2-integration-user-not-for-login',
      branchId: input.branchId,
      defaultFinanceAccountId: input.defaultFinanceAccountId ?? null,
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
  return user;
}

async function createPendingFixture(input: {
  type: AiPendingActionType;
  validatedData: unknown;
  user: CurrentUser;
  channel: 'WEB' | 'TELEGRAM';
  externalThreadId?: string;
}) {
  const conversation = await prisma.aiConversation.create({
    data: {
      userId: input.user.id,
      locale: 'en',
      channel: input.channel,
      externalThreadId: input.externalThreadId,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  const preconditions = await loadActionPreconditions(input.type, input.validatedData);
  expect(actionPreconditionIssues(input.type, input.validatedData, preconditions)).toEqual([]);
  return createPendingAction({
    conversationId: conversation.id,
    userId: input.user.id,
    type: input.type,
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

function customerDetails(name: string, phone: string) {
  return {
    nameEn: name,
    phone,
    email: `${name.toLowerCase().replaceAll(' ', '.')}@example.invalid`,
    governorate: 'BAGHDAD',
    address1: `District ${runMarker}`,
    street: 'Street 12, building 4',
    notes: 'Call before delivery',
    campaignSource: 'Phase 2 integration',
    segment: 'NEW' as const,
  };
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
    deliveryFee: 5_000,
    deliveryCost: 3_000,
    orderDiscount: 500,
    extraCharges: 250,
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
      lineDiscount: 1_000,
    }],
  });
}

function orderCommandInput(input: ReturnType<typeof orderFixture>) {
  return {
    locale: 'en' as const,
    placedAt: input.placedAt,
    customerExternalId: input.customerExternalId,
    newCustomer: input.newCustomer,
    customerEnrichment: input.customerEnrichment,
    channel: input.channel,
    governorate: input.governorate,
    fulfillmentMethod: input.fulfillmentMethod,
    status: input.status,
    deliveryFee: input.deliveryFee,
    deliveryCost: input.deliveryCost,
    orderDiscount: input.orderDiscount,
    extraCharges: input.extraCharges,
    notes: input.notes,
    financeMode: input.financeMode,
    financeAccountId: input.financeAccountId,
    financeProviderId: input.financeProviderId,
    financePaidAmount: input.financePaidAmount,
    financePaymentMethod: input.financePaymentMethod,
    financePaymentDate: input.financePaymentDate,
    financeDueDate: input.financeDueDate,
    lines: input.lines.map(({ sku, quantity, unitGrossPrice, lineDiscount }) => ({
      sku,
      quantity,
      unitGrossPrice,
      lineDiscount,
    })),
  };
}

function partyDetails(name: string, phone: string) {
  return ResolvedPartyActionSchema.parse({
    name,
    type: 'SERVICE_PROVIDER',
    phone,
    email: `${name.toLowerCase().replaceAll(' ', '.')}@example.invalid`,
    address: `Supplier address ${runMarker}`,
    notes: 'Phase 2 supplier fixture',
  });
}

function expenseFixture(input: { name: string; phone: string; accountId: string; branchId: string }) {
  return ResolvedExpenseActionSchema.parse({
    date: new Date().toISOString(),
    amount: null,
    currency: 'IQD',
    rate: null,
    accountId: input.accountId,
    categoryType: null,
    partyId: null,
    newParty: partyDetails(input.name, input.phone),
    description: `Multi-line expense ${runMarker}`,
    reference: `${runMarker}-${randomUUID().slice(0, 6)}`,
    branchId: input.branchId,
    lines: [
      {
        token: 'service',
        itemType: 'SERVICE',
        itemName: 'Machine maintenance',
        categoryType: 'MAINTENANCE',
        assetKey: null,
        assetCategory: null,
        inventoryItemId: null,
        inventoryItemMode: 'existing',
        newItemNameEn: '',
        newItemNameAr: '',
        newItemCategory: null,
        unit: 'unit',
        quantity: 1.125,
        unitCost: 8_000,
        discount: 500,
        extra: 250,
        branchId: input.branchId,
        notes: 'Service line',
      },
      {
        token: 'expense',
        itemType: 'EXPENSE',
        itemName: 'Local delivery',
        categoryType: 'SHIPPING',
        assetKey: null,
        assetCategory: null,
        inventoryItemId: null,
        inventoryItemMode: 'existing',
        newItemNameEn: '',
        newItemNameAr: '',
        newItemCategory: null,
        unit: 'unit',
        quantity: 2.375,
        unitCost: 2_000,
        discount: 0,
        extra: 0,
        branchId: input.branchId,
        notes: 'Operating line',
      },
    ],
  });
}

function expenseCommandInput(input: ReturnType<typeof expenseFixture>) {
  return {
    locale: 'en' as const,
    recordKind: 'MONEY_OUT' as const,
    date: input.date,
    currency: input.currency,
    rate: input.rate,
    accountId: input.accountId,
    partyId: input.partyId,
    newParty: input.newParty ?? undefined,
    categoryType: input.categoryType,
    branchId: input.branchId,
    description: input.description,
    reference: input.reference,
    lines: input.lines ?? undefined,
  };
}

async function expectReadyPdf(documentId: string | undefined, recordId: string): Promise<void> {
  expect(documentId).toBeTruthy();
  const document = await prisma.aiDocument.findUniqueOrThrow({ where: { id: documentId } });
  expect(document.recordId).toBe(recordId);
  expect(document.status).toBe('READY');
  expect(document.mimeType).toBe('application/pdf');
  expect(document.byteSize).toBeGreaterThan(1_000);
  expect(Buffer.from(document.content ?? []).subarray(0, 4).toString('ascii')).toBe('%PDF');
  expect(document.checksum).toMatch(/^[a-f0-9]{64}$/);
}

describeIntegration('AI Assistant Phase 2 database regressions', { timeout: remoteIntegrationTimeout }, () => {
  let branchId: string;
  let secondaryBranchId: string;
  let accountId: string;
  let owner: CurrentUser;
  let admin: CurrentUser;
  let manager: CurrentUser;
  let product: { id: string; sku: string; price: number };

  beforeAll(async () => {
    assertSafeIntegrationDatabase();
    const branches = await prisma.branch.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' }, take: 2 });
    expect(branches.length).toBeGreaterThanOrEqual(2);
    branchId = branches[0].id;
    secondaryBranchId = branches[1].id;
    const account = await prisma.financeAccount.findFirstOrThrow({
      where: { isActive: true, currency: 'IQD', type: { not: 'PAYMENT_GATEWAY' } },
      orderBy: { createdAt: 'asc' },
    });
    accountId = account.id;
    owner = await createFixtureUser({ role: 'OWNER', branchId, defaultFinanceAccountId: accountId });
    admin = await createFixtureUser({ role: 'ADMIN', branchId, defaultFinanceAccountId: accountId });
    manager = await createFixtureUser({ role: 'BRANCH_MANAGER', branchId: secondaryBranchId });
    const row = await prisma.product.findFirstOrThrow({
      where: { isActive: true },
      include: { prices: { where: { kind: 'BASE', effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'asc' },
    });
    product = { id: row.id, sku: row.sku, price: row.prices[0]?.price ?? row.sellingPrice };
    await prisma.telegramIdentity.createMany({
      data: [
        {
          telegramUserId: `${randomInt(1_000_000_000, 9_000_000_000)}`,
          privateChatId: `${randomInt(1_000_000_000, 9_000_000_000)}`,
          userId: owner.id,
          status: 'ACTIVE',
          linkedById: owner.id,
          linkedAt: new Date(),
        },
        {
          telegramUserId: `${randomInt(1_000_000_000, 9_000_000_000)}`,
          privateChatId: `${randomInt(1_000_000_000, 9_000_000_000)}`,
          userId: admin.id,
          status: 'REVOKED',
          linkedById: owner.id,
          linkedAt: new Date(),
          revokedAt: new Date(),
        },
        {
          telegramUserId: `${randomInt(1_000_000_000, 9_000_000_000)}`,
          privateChatId: `${randomInt(1_000_000_000, 9_000_000_000)}`,
          userId: manager.id,
          status: 'ACTIVE',
          linkedById: owner.id,
          linkedAt: new Date(),
        },
      ],
    });
  });

  it('keeps form, web AI, and Telegram order results equivalent and idempotent', async () => {
    const formInput = orderFixture({ product, name: 'Phase Form Customer', phone: nextPhone() });
    const webInput = orderFixture({ product, name: 'Phase Web Customer', phone: nextPhone() });
    const telegramInput = orderFixture({ product, name: 'Phase Telegram Customer', phone: nextPhone() });

    const formResult = await createOrderFromInput(orderCommandInput(formInput), {
      actorContext: createTrustedCommandContext(owner),
    });
    expect(formResult).toMatchObject({ ok: true });

    const webAction = await createPendingFixture({
      type: 'CREATE_ORDER',
      validatedData: webInput,
      user: owner,
      channel: 'WEB',
    });
    const webResult = await confirmPendingAction({ actionId: webAction.id, user: owner, locale: 'en' });
    expect(webResult).toMatchObject({ status: 'EXECUTED', documentStatus: 'READY', committed: true });
    const webReplay = await confirmPendingAction({ actionId: webAction.id, user: owner, locale: 'en' });
    expect(webReplay).toMatchObject({ recordId: webResult.recordId, documentId: webResult.documentId, replayed: true });

    const telegramAction = await createPendingFixture({
      type: 'CREATE_ORDER',
      validatedData: telegramInput,
      user: owner,
      channel: 'TELEGRAM',
      externalThreadId: 'phase2-order-chat',
    });
    const sentBefore = sendTelegramDocument.mock.calls.length;
    const telegramResult = await confirmPendingAction({ actionId: telegramAction.id, user: owner, locale: 'en' });
    expect(telegramResult).toMatchObject({ status: 'EXECUTED', documentStatus: 'READY', committed: true });
    expect(sendTelegramDocument.mock.calls.length).toBe(sentBefore + 1);
    const telegramReplay = await confirmPendingAction({ actionId: telegramAction.id, user: owner, locale: 'en' });
    expect(telegramReplay.recordId).toBe(telegramResult.recordId);
    expect(sendTelegramDocument.mock.calls.length).toBe(sentBefore + 1);

    const orders = await Promise.all([formResult?.recordId, webResult.recordId, telegramResult.recordId].map((id) => (
      prisma.order.findUniqueOrThrow({
        where: { id },
        include: { customer: true, lines: { orderBy: { sku: 'asc' } } },
      })
    )));
    for (const order of orders) {
      expect(order).toMatchObject({
        branchId,
        channel: 'POS',
        governorate: 'BAGHDAD',
        fulfillmentMethod: 'PICKUP',
        status: 'PENDING',
        grossAmount: product.price * 2,
        discountAmount: 1_500,
        orderDiscount: 500,
        deliveryFee: 5_000,
        deliveryCost: 3_000,
        extraCharges: 250,
      });
      expect(order.lines).toHaveLength(1);
      expect(order.lines[0]).toMatchObject({ sku: product.sku, quantity: 2, unitGrossPrice: product.price, lineDiscount: 1_000 });
      expect(order.customer).toMatchObject({
        email: expect.stringContaining('@example.invalid'),
        governorate: 'BAGHDAD',
        address1: `District ${runMarker}`,
        street: 'Street 12, building 4',
        notes: 'Call before delivery',
        campaignSource: 'Phase 2 integration',
      });
      expect(order.customer?.normalizedPhone).toBe(order.customer?.phone);
    }
    expect(new Set(orders.map((order) => order.customerId)).size).toBe(3);

    await expectReadyPdf(webResult.documentId, webResult.recordId as string);
    await expectReadyPdf(telegramResult.documentId, telegramResult.recordId as string);
    const invoice = await getInvoiceData(webResult.recordId as string);
    expect(invoice?.order.customer).toMatchObject({
      nameEn: 'Phase Web Customer',
      address1: `District ${runMarker}`,
      street: 'Street 12, building 4',
      notes: 'Call before delivery',
    });
    expect(await prisma.aiDeliveryOutbox.findUnique({
      where: {
        documentId_channel_destination: {
          documentId: telegramResult.documentId as string,
          channel: 'TELEGRAM',
          destination: 'phase2-order-chat',
        },
      },
    })).toMatchObject({ status: 'DELIVERED', externalMessageId: '92001' });
  });

  it('returns the original result to simultaneous confirmations without duplicate writes', async () => {
    const phone = nextPhone();
    const data = orderFixture({ product, name: 'Phase Concurrent Customer', phone });
    const action = await createPendingFixture({ type: 'CREATE_ORDER', validatedData: data, user: owner, channel: 'WEB' });
    const results = await Promise.all([
      confirmPendingAction({ actionId: action.id, user: owner, locale: 'en' }),
      confirmPendingAction({ actionId: action.id, user: owner, locale: 'en' }),
    ]);
    expect(results[0].recordId).toBe(results[1].recordId);
    expect(results.filter((result) => result.replayed).length).toBe(1);
    expect(await prisma.customer.count({ where: { normalizedPhone: phone } })).toBe(1);
    expect(await prisma.order.count({ where: { customer: { normalizedPhone: phone } } })).toBe(1);
    expect(await prisma.aiExecutionReceipt.count({ where: { pendingActionId: action.id } })).toBe(1);
    expect(await prisma.aiDocument.count({ where: { receipt: { pendingActionId: action.id } } })).toBe(1);
  });

  it('rolls back the customer and order when the final transaction hook fails', async () => {
    const phone = nextPhone();
    const data = orderFixture({ product, name: 'Phase Rolled Back Customer', phone });
    const result = await createOrderFromInput(orderCommandInput(data), {
      actorContext: createTrustedCommandContext(owner),
      onCommitted: async () => {
        throw new Error('phase2_forced_commit_failure');
      },
    });
    expect(result?.ok).not.toBe(true);
    expect(await prisma.customer.count({ where: { normalizedPhone: phone } })).toBe(0);
    expect(await prisma.order.count({ where: { notes: runMarker, customer: { normalizedPhone: phone } } })).toBe(0);
  });

  it('rolls back every order transaction checkpoint independently', async () => {
    for (const checkpoint of ORDER_CREATE_TRANSACTION_CHECKPOINTS) {
      const phone = nextPhone();
      const data = orderFixture({ product, name: `Phase Order ${checkpoint}`, phone });
      const result = await createOrderFromInput(orderCommandInput(data), {
        actorContext: createTrustedCommandContext(owner),
        afterStage: async (_tx, reached) => {
          if (reached === checkpoint) throw new Error(`phase2_forced_order_${checkpoint}`);
        },
      });

      expect(result?.ok, checkpoint).not.toBe(true);
      expect(await prisma.customer.count({ where: { normalizedPhone: phone } }), checkpoint).toBe(0);
      expect(await prisma.order.count({ where: { customer: { normalizedPhone: phone } } }), checkpoint).toBe(0);
    }
  });

  it('records equivalent multi-line spending with three-decimal quantities and finance PDFs', async () => {
    const formInput = expenseFixture({ name: 'Phase Form Supplier', phone: nextPhone(), accountId, branchId });
    const webInput = expenseFixture({ name: 'Phase Web Supplier', phone: nextPhone(), accountId, branchId });
    const telegramInput = expenseFixture({ name: 'Phase Telegram Supplier', phone: nextPhone(), accountId, branchId });

    const formResult = await createCentralRecordFromInput(expenseCommandInput(formInput), {
      actorContext: createTrustedCommandContext(owner),
    });
    expect(formResult).toMatchObject({ ok: true });

    const webAction = await createPendingFixture({ type: 'CREATE_EXPENSE', validatedData: webInput, user: owner, channel: 'WEB' });
    const webResult = await confirmPendingAction({ actionId: webAction.id, user: owner, locale: 'en' });
    const telegramAction = await createPendingFixture({
      type: 'CREATE_EXPENSE',
      validatedData: telegramInput,
      user: owner,
      channel: 'TELEGRAM',
      externalThreadId: 'phase2-expense-chat',
    });
    const telegramResult = await confirmPendingAction({ actionId: telegramAction.id, user: owner, locale: 'en' });

    const entries = await Promise.all([formResult?.recordId, webResult.recordId, telegramResult.recordId].map((id) => (
      prisma.financeEntry.findUniqueOrThrow({
        where: { id },
        include: { ledgerLines: { orderBy: { lineNo: 'asc' } }, party: true },
      })
    )));
    for (const entry of entries) {
      expect(entry).toMatchObject({
        type: 'EXPENSE',
        recordClass: 'EXPENSE',
        amount: 13_500,
        currency: 'IQD',
        obligation: false,
        accountId,
        branchId,
      });
      expect(entry.party).toMatchObject({ type: 'SERVICE_PROVIDER', address: `Supplier address ${runMarker}` });
      expect(entry.ledgerLines.map((line) => ({
        itemType: line.itemType,
        quantity: Number(line.quantity),
        treatment: line.spendTreatment,
        status: line.classificationStatus,
        lineTotal: line.lineTotal,
      }))).toEqual([
        { itemType: 'SERVICE', quantity: 1.125, treatment: 'OPEX', status: 'CONFIRMED', lineTotal: 8_750 },
        { itemType: 'EXPENSE', quantity: 2.375, treatment: 'OPEX', status: 'CONFIRMED', lineTotal: 4_750 },
      ]);
    }
    await expectReadyPdf(webResult.documentId, webResult.recordId as string);
    await expectReadyPdf(telegramResult.documentId, telegramResult.recordId as string);
    expect(await prisma.aiDeliveryOutbox.findFirst({
      where: { documentId: telegramResult.documentId, destination: 'phase2-expense-chat' },
    })).toMatchObject({ status: 'DELIVERED' });
  });

  it('rolls back the new party and every spending side effect on a final-hook failure', async () => {
    const phone = nextPhone();
    const data = expenseFixture({ name: 'Phase Rolled Back Supplier', phone, accountId, branchId });
    const reference = data.reference as string;
    const result = await createCentralRecordFromInput(expenseCommandInput(data), {
      actorContext: createTrustedCommandContext(owner),
      onCommitted: async () => {
        throw new Error('phase2_forced_commit_failure');
      },
    });
    expect(result?.ok).not.toBe(true);
    expect(await prisma.party.count({ where: { phone } })).toBe(0);
    expect(await prisma.financeEntry.count({ where: { reference } })).toBe(0);
    expect(await prisma.ledgerEntryLine.count({ where: { financeEntry: { reference } } })).toBe(0);
  });

  it('rolls back every spending transaction checkpoint independently', async () => {
    for (const checkpoint of CENTRAL_RECORD_TRANSACTION_CHECKPOINTS) {
      const phone = nextPhone();
      const data = expenseFixture({
        name: `Phase Spend ${checkpoint}`,
        phone,
        accountId,
        branchId,
      });
      const reference = data.reference as string;
      const result = await createCentralRecordFromInput(expenseCommandInput(data), {
        actorContext: createTrustedCommandContext(owner),
        afterStage: async (_tx, reached) => {
          if (reached === checkpoint) throw new Error(`phase2_forced_spend_${checkpoint}`);
        },
      });

      expect(result?.ok, checkpoint).not.toBe(true);
      expect(result?.stage, checkpoint).toBe(checkpoint);
      expect(await prisma.party.count({ where: { phone } }), checkpoint).toBe(0);
      expect(await prisma.financeEntry.count({ where: { reference } }), checkpoint).toBe(0);
      expect(await prisma.ledgerEntryLine.count({ where: { financeEntry: { reference } } }), checkpoint).toBe(0);
      expect(await prisma.fixedAsset.count({ where: { financeEntry: { reference } } }), checkpoint).toBe(0);
      expect(await prisma.stockMovement.count({ where: { financeEntry: { reference } } }), checkpoint).toBe(0);
    }
  });

  it('blocks expired, stale, cross-user, and revoked Telegram confirmations with no writes', async () => {
    const expiredPhone = nextPhone();
    const expired = await createPendingFixture({
      type: 'CREATE_ORDER',
      validatedData: orderFixture({ product, name: 'Phase Expired Customer', phone: expiredPhone }),
      user: owner,
      channel: 'WEB',
    });
    await prisma.aiPendingAction.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    await expect(confirmPendingAction({ actionId: expired.id, user: owner, locale: 'en' })).rejects.toThrow('action_expired');
    expect(await prisma.customer.count({ where: { normalizedPhone: expiredPhone } })).toBe(0);

    const stalePhone = nextPhone();
    const stale = await createPendingFixture({
      type: 'CREATE_ORDER',
      validatedData: orderFixture({ product, name: 'Phase Stale Customer', phone: stalePhone }),
      user: owner,
      channel: 'WEB',
    });
    await prisma.product.update({ where: { id: product.id }, data: { sellingPrice: { increment: 1 } } });
    await expect(confirmPendingAction({ actionId: stale.id, user: owner, locale: 'en' })).rejects.toThrow('action_stale');
    await prisma.product.update({ where: { id: product.id }, data: { sellingPrice: { decrement: 1 } } });
    expect(await prisma.customer.count({ where: { normalizedPhone: stalePhone } })).toBe(0);

    const crossUserPhone = nextPhone();
    const crossUser = await createPendingFixture({
      type: 'CREATE_ORDER',
      validatedData: orderFixture({ product, name: 'Phase Cross User Customer', phone: crossUserPhone }),
      user: owner,
      channel: 'WEB',
    });
    await expect(confirmPendingAction({ actionId: crossUser.id, user: admin, locale: 'en' })).rejects.toThrow('notfound');
    expect(await prisma.customer.count({ where: { normalizedPhone: crossUserPhone } })).toBe(0);

    const revokedPhone = nextPhone();
    const revoked = await createPendingFixture({
      type: 'CREATE_ORDER',
      validatedData: orderFixture({ product, name: 'Phase Revoked Customer', phone: revokedPhone }),
      user: admin,
      channel: 'TELEGRAM',
      externalThreadId: 'phase2-revoked-chat',
    });
    await expect(confirmPendingAction({ actionId: revoked.id, user: admin, locale: 'en' })).rejects.toThrow('forbidden');
    expect(await prisma.customer.count({ where: { normalizedPhone: revokedPhone } })).toBe(0);
  });

  it('keeps a branch-scoped Telegram order inside the linked user branch', async () => {
    const data = orderFixture({ product, name: 'Phase Branch Customer', phone: nextPhone() });
    const action = await createPendingFixture({
      type: 'CREATE_ORDER',
      validatedData: data,
      user: manager,
      channel: 'TELEGRAM',
      externalThreadId: 'phase2-branch-chat',
    });
    const result = await confirmPendingAction({ actionId: action.id, user: manager, locale: 'en' });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: result.recordId } });
    expect(order.branchId).toBe(secondaryBranchId);
    expect(order.createdById).toBe(manager.id);
    await expectReadyPdf(result.documentId, order.id);
  });
});
