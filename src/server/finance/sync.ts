import 'server-only';
import type { Prisma } from '@prisma/client';
import { roundMoney } from '@/lib/decimal';
import type { OrderMetricRole } from '@/lib/metrics/status';
import { providerFeeAmount, providerFeeCostRole } from '@/lib/provider-fees';

type Tx = Prisma.TransactionClient;

export type FinanceSyncMode = 'NONE' | 'CREDIT' | 'PAID' | 'PARTIAL' | 'PROVIDER';

const ORDER_KEY = (orderId: string, kind: 'AR' | 'PAY') => `ORD:${orderId}:${kind}`;
const ORDER_PARTIAL_KEY = (orderId: string) => `ORD:${orderId}:PARTIAL`;
const ORDER_PROVIDER_KEY = (orderId: string) => `ORD:${orderId}:PROVIDER`;
const ORDER_PROVIDER_FEE_KEY = (orderId: string) => `ORD:${orderId}:PROVIDER:FEE`;
const ORDER_PAYMENT_ADJUSTMENT_KEY = (orderId: string, invoiceTotal: number) =>
  `ORD:${orderId}:PAY:TOTAL:${invoiceTotal}`;
const RECEIPT_KEY = (movementId: string) => `INV:${movementId}:PUR`;

async function closeOrDeleteAutoEntry(tx: Tx, importKey: string, description: string): Promise<number> {
  const row = await tx.financeEntry.findUnique({
    where: { importKey },
    include: {
      settlements: {
        where: { archivedAt: null, reversedAt: null, reversalOfId: null },
        select: { amount: true },
      },
    },
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

export async function syncOrderProviderCollection(
  tx: Tx,
  orderId: string,
  input: {
    providerPartyId: string;
    dueDate?: Date | null;
    createdById?: string | null;
    paymentMethod?: string | null;
  },
) {
  const provider = await tx.party.findUnique({
    where: { id: input.providerPartyId },
    select: {
      id: true,
      name: true,
      collectsOrderPayments: true,
      isActive: true,
      defaultSettlementAccountId: true,
      automaticOrderSettlement: true,
      providerFeeMode: true,
      feeRateBps: true,
      fixedFee: true,
    },
  });
  if (!provider?.isActive || !provider.collectsOrderPayments) throw new Error('provider');

  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      placedAt: true,
      grossAmount: true,
      discountAmount: true,
      refundAmount: true,
      deliveryFee: true,
      deliveryCost: true,
      extraCharges: true,
      branchId: true,
    },
  });
  if (!order) throw new Error('notfound');

  const entries = await tx.financeEntry.findMany({
    where: {
      OR: [{ orderId }, { settles: { is: { orderId } } }],
      archivedAt: null,
      reversedAt: null,
      reversalOfId: null,
    },
    include: {
      party: { select: { collectsOrderPayments: true } },
      settlements: {
        where: { archivedAt: null, reversedAt: null, reversalOfId: null },
        select: { amount: true },
      },
    },
  });
  const receivables = entries.filter(
    (entry) => entry.orderId === orderId && entry.obligation && entry.obligationKind === 'RECEIVABLE',
  );
  const providerReceivables = receivables.filter(
    (entry) => entry.party?.collectsOrderPayments === true,
  );
  const customerReceivableIds = new Set(
    receivables
      .filter((entry) => entry.party?.collectsOrderPayments !== true)
      .map((entry) => entry.id),
  );
  const directIncomeEntries = entries.filter(
    (entry) =>
      entry.orderId === orderId &&
      !entry.obligation &&
      entry.type === 'INCOME' &&
      !entry.settlesId,
  );
  const paidDirectly = directIncomeEntries
    .filter((entry) => entry.party?.collectsOrderPayments !== true)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const paidAgainstCustomerCredit = entries
    .filter(
      (entry) =>
        entry.type === 'PAYMENT_IN' &&
        entry.settlesId != null &&
        customerReceivableIds.has(entry.settlesId),
    )
    .reduce((sum, entry) => sum + entry.amount, 0);
  const total = Math.max(
    0,
    order.grossAmount -
      order.discountAmount -
      order.refundAmount +
      order.deliveryFee +
      order.extraCharges,
  );
  const providerAmount = Math.max(0, total - paidDirectly - paidAgainstCustomerCredit);
  if (providerAmount <= 0) throw new Error('already_paid');

  for (const receivable of receivables.filter(
    (entry) => entry.party?.collectsOrderPayments !== true,
  )) {
    const settled = receivable.settlements.reduce((sum, entry) => sum + entry.amount, 0);
    if (settled > 0) {
      await tx.financeEntry.update({
        where: { id: receivable.id },
        data: {
          amount: settled,
          description: `Customer payment retained for order ${order.orderNumber}`,
        },
      });
    } else {
      await tx.financeEntry.update({
        where: { id: receivable.id },
        data: {
          archivedAt: new Date(),
          archiveReason: `Replaced by ${provider.name} collection`,
        },
      });
    }
  }

  if (provider.automaticOrderSettlement) {
    if (!provider.defaultSettlementAccountId) throw new Error('provider_account');

    for (const receivable of providerReceivables) {
      if (receivable.settlements.length > 0) throw new Error('provider_settled');
      await tx.financeEntry.update({
        where: { id: receivable.id },
        data: {
          archivedAt: new Date(),
          archiveReason: `Replaced by automatic ${provider.name} collection`,
        },
      });
    }

    const providerDirectEntries = directIncomeEntries.filter(
      (entry) => entry.party?.collectsOrderPayments === true,
    );
    const matchingDirect =
      providerDirectEntries.find((entry) => entry.partyId === provider.id) ??
      providerDirectEntries[0] ??
      null;
    for (const entry of providerDirectEntries) {
      if (entry.id === matchingDirect?.id) continue;
      await tx.financeEntry.update({
        where: { id: entry.id },
        data: {
          archivedAt: new Date(),
          archiveReason: `Replaced by automatic ${provider.name} collection`,
        },
      });
    }

    const receiptData = {
      date: order.placedAt,
      type: 'INCOME' as const,
      amount: providerAmount,
      currency: 'IQD' as const,
      obligation: false,
      obligationKind: null,
      dueDate: null,
      accountId: provider.defaultSettlementAccountId,
      partyId: provider.id,
      paymentMethod: input.paymentMethod ?? 'PROVIDER_COLLECTION',
      branchId: order.branchId,
      orderId: order.id,
      reference: order.orderNumber,
      description: `Automatically collected by ${provider.name}: ${order.orderNumber}`,
      settlesId: null,
      providerSettlementId: null,
      archivedAt: null,
      archiveReason: null,
    };
    if (matchingDirect) {
      await tx.financeEntry.update({
        where: { id: matchingDirect.id },
        data: receiptData,
      });
    } else {
      await tx.financeEntry.upsert({
        where: { importKey: ORDER_PROVIDER_KEY(order.id) },
        create: {
          ...receiptData,
          importKey: ORDER_PROVIDER_KEY(order.id),
          createdById: input.createdById ?? null,
        },
        update: receiptData,
      });
    }

    const fee = providerFeeAmount(providerAmount, order.deliveryCost, {
      mode: provider.providerFeeMode,
      rateBps: provider.feeRateBps,
      fixedAmount: provider.fixedFee,
    });
    if (fee > 0) {
      const feeData = {
        date: order.placedAt,
        type: 'EXPENSE' as const,
        recordClass: 'EXPENSE' as const,
        amount: fee,
        currency: 'IQD' as const,
        categoryType: provider.providerFeeMode === 'ORDER_DELIVERY_COST' ? 'SHIPPING' : 'TECH',
        costRole: providerFeeCostRole(provider.providerFeeMode),
        obligation: false,
        obligationKind: null,
        dueDate: null,
        accountId: provider.defaultSettlementAccountId,
        partyId: provider.id,
        paymentMethod: input.paymentMethod ?? 'PROVIDER_COLLECTION',
        branchId: order.branchId,
        orderId: order.id,
        reference: order.orderNumber,
        description: `${provider.name} fee deducted automatically: ${order.orderNumber}`,
        settlesId: null,
        providerSettlementId: null,
        archivedAt: null,
        archiveReason: null,
      };
      await tx.financeEntry.upsert({
        where: { importKey: ORDER_PROVIDER_FEE_KEY(order.id) },
        create: {
          ...feeData,
          importKey: ORDER_PROVIDER_FEE_KEY(order.id),
          createdById: input.createdById ?? null,
        },
        update: feeData,
      });
    } else {
      await closeOrDeleteAutoEntry(
        tx,
        ORDER_PROVIDER_FEE_KEY(order.id),
        `No automatic provider fee for order ${order.orderNumber}`,
      );
    }
    return;
  }

  const matchingProviderReceivable =
    providerReceivables.find((entry) => entry.partyId === provider.id) ??
    providerReceivables.find((entry) => entry.settlements.length === 0) ??
    null;
  for (const receivable of providerReceivables) {
    if (receivable.id === matchingProviderReceivable?.id) continue;
    if (receivable.settlements.length > 0) throw new Error('provider_settled');
    await tx.financeEntry.update({
      where: { id: receivable.id },
      data: {
        archivedAt: new Date(),
        archiveReason: `Replaced by ${provider.name} collection`,
      },
    });
  }

  const settledProviderAmount =
    matchingProviderReceivable?.settlements.reduce((sum, entry) => sum + entry.amount, 0) ?? 0;
  if (settledProviderAmount > providerAmount) throw new Error('provider_settled');
  const data = {
    date: order.placedAt,
    type: 'INCOME' as const,
    amount: providerAmount,
    currency: 'IQD' as const,
    obligation: true,
    obligationKind: 'RECEIVABLE' as const,
    dueDate: input.dueDate ?? order.placedAt,
    accountId: null,
    partyId: provider.id,
    paymentMethod: input.paymentMethod ?? 'PROVIDER_COLLECTION',
    branchId: order.branchId,
    orderId: order.id,
    reference: order.orderNumber,
    description: `Collected by ${provider.name}: ${order.orderNumber}`,
    archivedAt: null,
    archiveReason: null,
  };
  if (matchingProviderReceivable) {
    await tx.financeEntry.update({
      where: { id: matchingProviderReceivable.id },
      data,
    });
  } else {
    await tx.financeEntry.upsert({
      where: { importKey: ORDER_PROVIDER_KEY(order.id) },
      create: {
        ...data,
        importKey: ORDER_PROVIDER_KEY(order.id),
        createdById: input.createdById ?? null,
      },
      update: data,
    });
  }
}

export async function syncOrderCustomerBalance(
  tx: Tx,
  orderId: string,
  input: {
    dueDate?: Date | null;
    createdById?: string | null;
  },
) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      placedAt: true,
      grossAmount: true,
      discountAmount: true,
      refundAmount: true,
      deliveryFee: true,
      extraCharges: true,
      branchId: true,
    },
  });
  if (!order) throw new Error('notfound');
  const entries = await tx.financeEntry.findMany({
    where: {
      OR: [{ orderId }, { settles: { is: { orderId } } }],
      archivedAt: null,
      reversedAt: null,
      reversalOfId: null,
    },
    include: {
      party: { select: { collectsOrderPayments: true } },
      settlements: {
        where: { archivedAt: null, reversedAt: null, reversalOfId: null },
        select: { amount: true },
      },
    },
  });
  const direct = entries
    .filter(
      (entry) =>
        entry.orderId === orderId &&
        entry.type === 'INCOME' &&
        !entry.obligation &&
        !entry.settlesId,
    )
    .reduce((sum, entry) => sum + entry.amount, 0);
  const providerReceivables = entries
    .filter(
      (entry) =>
        entry.orderId === orderId &&
        entry.obligation &&
        entry.obligationKind === 'RECEIVABLE' &&
        entry.party?.collectsOrderPayments === true,
    )
    .reduce((sum, entry) => sum + entry.amount, 0);
  const total = Math.max(
    0,
    order.grossAmount -
      order.discountAmount -
      order.refundAmount +
      order.deliveryFee +
      order.extraCharges,
  );
  const target = Math.max(0, total - direct - providerReceivables);
  const customerReceivables = entries.filter(
    (entry) =>
      entry.orderId === orderId &&
      entry.obligation &&
      entry.obligationKind === 'RECEIVABLE' &&
      entry.party?.collectsOrderPayments !== true,
  );
  const settledTotal = customerReceivables.reduce(
    (sum, entry) => sum + entry.settlements.reduce((paid, row) => paid + row.amount, 0),
    0,
  );
  if (settledTotal > target) throw new Error('payment_exceeds_total');

  const primary =
    customerReceivables.find((entry) => entry.importKey === ORDER_KEY(orderId, 'AR')) ??
    customerReceivables[0] ??
    null;
  let retainedOutsidePrimary = 0;
  for (const entry of customerReceivables) {
    if (entry.id === primary?.id) continue;
    const settled = entry.settlements.reduce((sum, row) => sum + row.amount, 0);
    retainedOutsidePrimary += settled;
    await tx.financeEntry.update({
      where: { id: entry.id },
      data:
        settled > 0
          ? {
              amount: settled,
              description: `Customer payment retained for order ${order.orderNumber}`,
            }
          : {
              archivedAt: new Date(),
              archiveReason: `Consolidated order receivable ${order.orderNumber}`,
            },
    });
  }

  const primaryTarget = Math.max(0, target - retainedOutsidePrimary);
  if (primaryTarget <= 0) {
    if (primary) {
      const settled = primary.settlements.reduce((sum, row) => sum + row.amount, 0);
      await tx.financeEntry.update({
        where: { id: primary.id },
        data:
          settled > 0
            ? { amount: settled }
            : {
                archivedAt: new Date(),
                archiveReason: `No customer balance for order ${order.orderNumber}`,
              },
      });
    }
    return;
  }

  const partyId = primary?.partyId ?? (await resolveOrderParty(tx, orderId));
  const data = {
    date: order.placedAt,
    type: 'INCOME' as const,
    amount: primaryTarget,
    currency: 'IQD' as const,
    obligation: true,
    obligationKind: 'RECEIVABLE' as const,
    dueDate: input.dueDate ?? order.placedAt,
    accountId: null,
    partyId,
    paymentMethod: null,
    branchId: order.branchId,
    orderId: order.id,
    reference: order.orderNumber,
    description: `Order receivable: ${order.orderNumber}`,
    archivedAt: null,
    archiveReason: null,
  };
  if (primary) {
    await tx.financeEntry.update({ where: { id: primary.id }, data });
  } else {
    await tx.financeEntry.upsert({
      where: { importKey: ORDER_KEY(orderId, 'AR') },
      create: {
        ...data,
        importKey: ORDER_KEY(orderId, 'AR'),
        createdById: input.createdById ?? null,
      },
      update: data,
    });
  }
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

  if (input.mode === 'PROVIDER') {
    if (!input.partyId) throw new Error('provider');
    await syncOrderProviderCollection(tx, order.id, {
      providerPartyId: input.partyId,
      dueDate: input.dueDate,
      createdById: input.createdById,
      paymentMethod: input.paymentMethod,
    });
    return;
  }

  const isPaid = input.mode === 'PAID';
  const isPartial = input.mode === 'PARTIAL';
  if ((isPaid || isPartial) && !input.accountId) throw new Error('account');

  if (isPaid) {
    const existingEntries = await tx.financeEntry.findMany({
      where: {
        OR: [{ orderId: order.id }, { settles: { is: { orderId: order.id } } }],
        archivedAt: null,
        reversedAt: null,
        reversalOfId: null,
      },
      include: {
        party: { select: { collectsOrderPayments: true } },
        settlements: {
          where: { archivedAt: null, reversedAt: null, reversalOfId: null },
          select: { amount: true },
        },
      },
    });
    const customerReceivables = existingEntries.filter(
      (entry) =>
        entry.orderId === order.id &&
        entry.obligation &&
        entry.obligationKind === 'RECEIVABLE' &&
        entry.party?.collectsOrderPayments !== true,
    );
    const providerCoverage = existingEntries
      .filter(
        (entry) =>
          entry.orderId === order.id &&
          entry.obligation &&
          entry.obligationKind === 'RECEIVABLE' &&
          entry.party?.collectsOrderPayments === true,
      )
      .reduce((sum, entry) => sum + entry.amount, 0);
    const customerSettlementCoverage = customerReceivables.reduce(
      (sum, entry) => sum + entry.settlements.reduce((paid, settlement) => paid + settlement.amount, 0),
      0,
    );
    const directPayments = existingEntries.filter(
      (entry) =>
        entry.orderId === order.id &&
        !entry.obligation &&
        entry.type === 'INCOME' &&
        !entry.settlesId,
    );
    const directCoverage = directPayments
      .reduce((sum, entry) => sum + entry.amount, 0);
    const existingPrimaryPayment = directPayments.find(
      (entry) => entry.importKey === paidKey,
    );

    for (const receivable of customerReceivables) {
      const settled = receivable.settlements.reduce((sum, settlement) => sum + settlement.amount, 0);
      await tx.financeEntry.update({
        where: { id: receivable.id },
        data:
          settled > 0
            ? {
                amount: settled,
                description: `Customer payments retained for order ${order.orderNumber}`,
              }
            : {
                archivedAt: new Date(),
                archiveReason: `Closed receivable for paid order ${order.orderNumber}`,
              },
      });
    }

    const covered = providerCoverage + customerSettlementCoverage + directCoverage;
    if (covered > amount) throw new Error('payment_exceeds_total');
    const directPaidAmount = amount - covered;
    if (directPaidAmount <= 0) {
      return;
    }
    const partyId = input.partyId ?? await resolveOrderParty(tx, order.id);
    const importKey = existingPrimaryPayment
      ? ORDER_PAYMENT_ADJUSTMENT_KEY(order.id, amount)
      : paidKey;
    await tx.financeEntry.upsert({
      where: { importKey },
      create: {
        importKey,
        date: input.paymentDate ?? order.placedAt,
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
        description: existingPrimaryPayment
          ? `Invoice increase paid: ${order.orderNumber}`
          : `Order paid: ${order.orderNumber}`,
        archivedAt: null,
        archiveReason: null,
        createdById: input.createdById ?? null,
      },
      update: {
        date: input.paymentDate ?? order.placedAt,
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
        description: existingPrimaryPayment
          ? `Invoice increase paid: ${order.orderNumber}`
          : `Order paid: ${order.orderNumber}`,
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
      paymentMethod: null,
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
      paymentMethod: null,
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
  await closeOrDeleteAutoEntry(tx, ORDER_PROVIDER_KEY(orderId), `Closed provider collection for deleted order ${orderId}`);
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
