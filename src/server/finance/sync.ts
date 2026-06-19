import 'server-only';
import type { Prisma } from '@prisma/client';
import { roundMoney } from '@/lib/decimal';
import type { OrderMetricRole } from '@/lib/metrics/status';

type Tx = Prisma.TransactionClient;

export type FinanceSyncMode = 'NONE' | 'CREDIT' | 'PAID' | 'PARTIAL';

const ORDER_KEY = (orderId: string, kind: 'AR' | 'PAY') => `ORD:${orderId}:${kind}`;
const ORDER_PARTIAL_KEY = (orderId: string) => `ORD:${orderId}:PARTIAL`;
const RECEIPT_KEY = (movementId: string) => `INV:${movementId}:PUR`;

async function closeOrDeleteAutoEntry(tx: Tx, importKey: string, description: string): Promise<number> {
  const row = await tx.financeEntry.findUnique({
    where: { importKey },
    include: { settlements: { select: { amount: true } } },
  });
  if (!row) return 0;
  const settled = row.settlements.reduce((sum, s) => sum + s.amount, 0);
  if (settled > 0) {
    await tx.financeEntry.update({
      where: { id: row.id },
      data: {
        amount: settled,
        description,
      },
    });
    return settled;
  }
  await tx.financeEntry.update({
    where: { id: row.id },
    data: { archivedAt: new Date(), archiveReason: description, description },
  });
  return 0;
}

async function resolveOrderParty(tx: Tx, orderId: string) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      customer: {
        select: {
          externalId: true,
          phone: true,
          email: true,
          nameEn: true,
          nameAr: true,
        },
      },
    },
  });
  const customer = order?.customer;
  if (!customer) return null;

  const name = customer.nameEn || customer.nameAr || customer.phone || customer.email || customer.externalId;
  if (!name) return null;
  const partyMatches: Prisma.PartyWhereInput[] = [{ name }];
  if (customer.phone) partyMatches.push({ phone: customer.phone });
  if (customer.email) partyMatches.push({ email: customer.email });
  const existing = await tx.party.findFirst({
    where: {
      type: 'CUSTOMER',
      OR: partyMatches,
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const party = await tx.party.create({
    data: {
      name,
      type: 'CUSTOMER',
      phone: customer.phone ?? null,
      email: customer.email ?? null,
      notes: customer.externalId ? `Synced from customer ${customer.externalId}` : 'Synced from order',
    },
    select: { id: true },
  });
  return party.id;
}

export async function syncOrderFinance(
  tx: Tx,
  orderId: string,
  input: {
    mode: FinanceSyncMode;
    accountId?: string | null;
    dueDate?: Date | null;
    createdById?: string | null;
    paidAmount?: number | null;
    paymentMethod?: string | null;
    paymentDate?: Date | null;
    partyId?: string | null;
    statusRole: OrderMetricRole;
  },
) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      placedAt: true,
      status: true,
      grossAmount: true,
      discountAmount: true,
      refundAmount: true,
      deliveryFee: true,
      extraCharges: true,
      branchId: true,
    },
  });
  if (!order) return;

  const amount = Math.max(
    0,
    order.grossAmount - order.discountAmount - order.refundAmount + order.deliveryFee + order.extraCharges,
  );
  const canSync = amount > 0 && (input.statusRole === 'OPEN' || input.statusRole === 'SALE');
  const arKey = ORDER_KEY(order.id, 'AR');
  const paidKey = ORDER_KEY(order.id, 'PAY');

  if (!canSync || input.mode === 'NONE') {
    await closeOrDeleteAutoEntry(tx, arKey, `Closed finance sync for order ${order.orderNumber}`);
    await closeOrDeleteAutoEntry(tx, paidKey, `Closed finance sync for order ${order.orderNumber}`);
    await closeOrDeleteAutoEntry(tx, ORDER_PARTIAL_KEY(order.id), `Closed partial payment sync for order ${order.orderNumber}`);
    return;
  }

  const isPaid = input.mode === 'PAID';
  const isPartial = input.mode === 'PARTIAL';
  if ((isPaid || isPartial) && !input.accountId) return;

  if (isPaid) {
    await closeOrDeleteAutoEntry(tx, ORDER_PARTIAL_KEY(order.id), `Replaced by paid income sync for order ${order.orderNumber}`);
    const settledKept = await closeOrDeleteAutoEntry(tx, arKey, `Closed receivable sync for paid order ${order.orderNumber}`);
    const directPaidAmount = Math.max(0, amount - settledKept);
    if (directPaidAmount <= 0) {
      await closeOrDeleteAutoEntry(tx, paidKey, `Closed paid income sync for order ${order.orderNumber}`);
      return;
    }
    const partyId = input.partyId ?? await resolveOrderParty(tx, order.id);
    await tx.financeEntry.upsert({
      where: { importKey: paidKey },
      create: {
        importKey: paidKey,
        date: order.placedAt,
        type: 'INCOME',
        amount: directPaidAmount,
        currency: 'IQD',
        obligation: false,
        accountId: input.accountId ?? null,
        partyId,
        paymentMethod: input.paymentMethod ?? null,
        branchId: order.branchId,
        orderId: order.id,
        reference: order.orderNumber,
        description: `Order paid: ${order.orderNumber}`,
        archivedAt: null,
        archiveReason: null,
        createdById: input.createdById ?? null,
      },
      update: {
        date: order.placedAt,
        type: 'INCOME',
        amount: directPaidAmount,
        currency: 'IQD',
        obligation: false,
        obligationKind: null,
        dueDate: null,
        accountId: input.accountId ?? null,
        partyId,
        paymentMethod: input.paymentMethod ?? null,
        branchId: order.branchId,
        orderId: order.id,
        reference: order.orderNumber,
        description: `Order paid: ${order.orderNumber}`,
        archivedAt: null,
        archiveReason: null,
      },
    });
    return;
  }

  await closeOrDeleteAutoEntry(tx, paidKey, `Replaced by receivable sync for order ${order.orderNumber}`);

  const partyId = input.partyId ?? await resolveOrderParty(tx, order.id);
  const receivable = await tx.financeEntry.upsert({
    where: { importKey: arKey },
    create: {
      importKey: arKey,
      date: order.placedAt,
      type: 'INCOME',
      amount,
      currency: 'IQD',
      obligation: true,
      obligationKind: 'RECEIVABLE',
      dueDate: input.dueDate ?? order.placedAt,
      accountId: null,
      partyId,
      branchId: order.branchId,
      orderId: order.id,
      reference: order.orderNumber,
      description: `Order receivable: ${order.orderNumber}`,
      archivedAt: null,
      archiveReason: null,
      createdById: input.createdById ?? null,
    },
    update: {
      date: order.placedAt,
      type: 'INCOME',
      amount,
      currency: 'IQD',
      obligation: true,
      obligationKind: 'RECEIVABLE',
      dueDate: input.dueDate ?? order.placedAt,
      accountId: null,
      partyId,
      branchId: order.branchId,
      orderId: order.id,
      reference: order.orderNumber,
      description: `Order receivable: ${order.orderNumber}`,
      archivedAt: null,
      archiveReason: null,
    },
    select: { id: true },
  });

  if (!isPartial) {
    await closeOrDeleteAutoEntry(tx, ORDER_PARTIAL_KEY(order.id), `Closed partial payment sync for order ${order.orderNumber}`);
    return;
  }

  const paidAmount = Math.min(amount, Math.max(0, input.paidAmount ?? 0));
  if (paidAmount <= 0) {
    await closeOrDeleteAutoEntry(tx, ORDER_PARTIAL_KEY(order.id), `Closed empty partial payment sync for order ${order.orderNumber}`);
    return;
  }

  await tx.financeEntry.upsert({
    where: { importKey: ORDER_PARTIAL_KEY(order.id) },
    create: {
      importKey: ORDER_PARTIAL_KEY(order.id),
      date: input.paymentDate ?? order.placedAt,
      type: 'PAYMENT_IN',
      amount: paidAmount,
      currency: 'IQD',
      obligation: false,
      accountId: input.accountId ?? null,
      partyId,
      paymentMethod: input.paymentMethod ?? null,
      settlesId: receivable.id,
      branchId: order.branchId,
      orderId: order.id,
      reference: order.orderNumber,
      description: `Partial payment: ${order.orderNumber}`,
      archivedAt: null,
      archiveReason: null,
      createdById: input.createdById ?? null,
    },
    update: {
      date: input.paymentDate ?? order.placedAt,
      type: 'PAYMENT_IN',
      amount: paidAmount,
      currency: 'IQD',
      obligation: false,
      obligationKind: null,
      dueDate: null,
      accountId: input.accountId ?? null,
      partyId,
      paymentMethod: input.paymentMethod ?? null,
      settlesId: receivable.id,
      branchId: order.branchId,
      orderId: order.id,
      reference: order.orderNumber,
      description: `Partial payment: ${order.orderNumber}`,
      archivedAt: null,
      archiveReason: null,
    },
  });
}

export async function closeOrderFinance(tx: Tx, orderId: string) {
  await closeOrDeleteAutoEntry(tx, ORDER_KEY(orderId, 'AR'), `Closed finance sync for deleted order ${orderId}`);
  await closeOrDeleteAutoEntry(tx, ORDER_KEY(orderId, 'PAY'), `Closed finance sync for deleted order ${orderId}`);
  await closeOrDeleteAutoEntry(tx, ORDER_PARTIAL_KEY(orderId), `Closed partial payment sync for deleted order ${orderId}`);
}

function categoryForInventory(category: string) {
  if (category === 'GREEN_COFFEE') return 'GREEN_COFFEE' as const;
  if (category === 'PACKAGING') return 'PACKAGING' as const;
  return null;
}

export async function syncInventoryReceiptFinance(
  tx: Tx,
  input: {
    movementId: string;
    inventoryItemId: string;
    quantity: number;
    unitCost: number;
    receivedAt: Date;
    paymentMode: Exclude<FinanceSyncMode, 'NONE'>;
    accountId?: string | null;
    partyId?: string | null;
    dueDate?: Date | null;
    reference?: string | null;
    createdById?: string | null;
  },
): Promise<string | null> {
  const amount = roundMoney(input.quantity * input.unitCost);
  if (amount <= 0) return null;
  if (input.paymentMode === 'PAID' && !input.accountId) return null;

  const item = await tx.inventoryItem.findUnique({
    where: { id: input.inventoryItemId },
    select: { nameEn: true, nameAr: true, category: true, branchId: true },
  });
  if (!item) return null;

  const isPaid = input.paymentMode === 'PAID';
  const importKey = RECEIPT_KEY(input.movementId);
  const entry = await tx.financeEntry.upsert({
    where: { importKey },
    create: {
      importKey,
      date: input.receivedAt,
      type: 'PURCHASE',
      amount,
      currency: 'IQD',
      obligation: !isPaid,
      obligationKind: isPaid ? null : 'PAYABLE',
      dueDate: isPaid ? null : input.dueDate ?? input.receivedAt,
      accountId: isPaid ? input.accountId ?? null : null,
      partyId: input.partyId ?? null,
      categoryType: categoryForInventory(item.category),
      branchId: item.branchId,
      reference: input.reference ?? null,
      description: `Inventory purchase: ${item.nameEn || item.nameAr}`,
      createdById: input.createdById ?? null,
    },
    update: {
      date: input.receivedAt,
      type: 'PURCHASE',
      amount,
      currency: 'IQD',
      obligation: !isPaid,
      obligationKind: isPaid ? null : 'PAYABLE',
      dueDate: isPaid ? null : input.dueDate ?? input.receivedAt,
      accountId: isPaid ? input.accountId ?? null : null,
      partyId: input.partyId ?? null,
      categoryType: categoryForInventory(item.category),
      branchId: item.branchId,
      reference: input.reference ?? null,
      description: `Inventory purchase: ${item.nameEn || item.nameAr}`,
    },
    select: { id: true },
  });
  return entry.id;
}
