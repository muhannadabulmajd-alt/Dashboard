import 'server-only';
import type { Prisma } from '@prisma/client';
import type { OrderInput } from '@/server/ingestion/parsers';
import type { OrderMetricRole } from '@/lib/metrics/status';
import { syncOrderFinance } from '@/server/finance/sync';
import { applySoldMovements, syncCustomerStats } from '@/server/orders/sync';
import { syncActiveCostForProducts } from '@/server/inventory/fifo';

type Tx = Prisma.TransactionClient;

export async function upsertImportedOrder(
  tx: Tx,
  order: OrderInput,
  input: {
    branchId: string | null;
    uploadBatchId: string;
    userId: string | null;
    statusRole: OrderMetricRole;
    saleStatuses: string[];
  },
): Promise<{ inserted: boolean; productIds: string[] }> {
  const customer = order.customerExternalId
    ? await tx.customer.findUnique({ where: { externalId: order.customerExternalId }, select: { id: true } })
    : null;
  if (order.customerExternalId && !customer) {
    throw new Error(`${order.orderNumber}: unknown customer ${order.customerExternalId}`);
  }

  const lineData: {
    productId: string;
    sku: string;
    quantity: number;
    unitLabel: string;
    unitGrossPrice: number;
    lineDiscount: number;
    lineNet: number;
    unitCogsSnapshot: number;
  }[] = [];
  for (const line of order.lines) {
    const product = await tx.product.findUnique({
      where: { sku: line.sku },
      select: { id: true, cogsPerUnit: true, sellUnit: true, isActive: true },
    });
    if (!product || !product.isActive) throw new Error(`${order.orderNumber}: unknown or inactive SKU ${line.sku}`);
    lineData.push({
      productId: product.id,
      sku: line.sku,
      quantity: line.quantity,
      unitLabel: product.sellUnit,
      unitGrossPrice: line.unitGrossPrice,
      lineDiscount: line.lineDiscount,
      lineNet: line.unitGrossPrice * line.quantity - line.lineDiscount,
      unitCogsSnapshot: product.cogsPerUnit,
    });
  }
  if (!lineData.length) throw new Error(`${order.orderNumber}: no valid lines`);

  const account = order.paymentAccountKey
    ? await tx.financeAccount.findUnique({ where: { externalKey: order.paymentAccountKey }, select: { id: true } })
    : null;
  const party = order.paymentPartyKey
    ? await tx.party.findUnique({
        where: { externalKey: order.paymentPartyKey },
        select: { id: true, collectsOrderPayments: true },
      })
    : null;
  if (order.paymentMode === 'PAID' && !account) {
    throw new Error(`${order.orderNumber}: paid orders require a valid payment account key`);
  }
  if (order.paymentMode === 'CREDIT' && !party) {
    throw new Error(`${order.orderNumber}: credit orders require a valid payment party key`);
  }
  if (
    input.statusRole === 'SALE' &&
    order.paymentMode === 'CREDIT' &&
    !party?.collectsOrderPayments
  ) {
    throw new Error(
      `${order.orderNumber}: completed orders must be paid directly or collected by a configured provider`,
    );
  }

  const existing = await tx.order.findUnique({
    where: { orderNumber: order.orderNumber },
    select: { id: true, customerId: true, lines: { select: { productId: true } } },
  });
  const gross = lineData.reduce((sum, line) => sum + line.unitGrossPrice * line.quantity, 0);
  const discount = lineData.reduce((sum, line) => sum + line.lineDiscount, 0);
  const refund = input.statusRole === 'RETURN' ? Math.max(0, gross - discount + order.deliveryFee) : 0;
  const data = {
    placedAt: order.placedAt,
    customerId: customer?.id ?? null,
    branchId: input.branchId,
    createdById: input.userId,
    channel: order.channel,
    governorate: order.governorate,
    fulfillmentMethod: order.fulfillmentMethod,
    status: order.status,
    grossAmount: gross,
    discountAmount: discount,
    refundAmount: refund,
    deliveryFee: order.deliveryFee,
    deliveryCost: order.deliveryCost,
    uploadBatchId: input.uploadBatchId,
    inventorySyncMode: order.inventorySyncMode,
  };

  let orderId: string;
  if (existing) {
    orderId = existing.id;
    await tx.orderLine.deleteMany({ where: { orderId } });
    await tx.stockMovement.deleteMany({ where: { orderId } });
    await tx.order.update({ where: { id: orderId }, data });
  } else {
    const created = await tx.order.create({ data: { orderNumber: order.orderNumber, ...data } });
    orderId = created.id;
  }
  await tx.orderLine.createMany({ data: lineData.map((line) => ({ ...line, orderId })) });
  if (input.statusRole === 'SALE' && order.inventorySyncMode === 'NORMAL') {
    await applySoldMovements(tx, orderId, order.placedAt, lineData);
  }
  await syncActiveCostForProducts(lineData.map((line) => line.productId), tx);

  const financeMode = input.statusRole === 'SALE' ? order.paymentMode : 'NONE';
  await syncOrderFinance(tx, orderId, {
    mode: financeMode,
    accountId: account?.id ?? null,
    partyId: party?.id ?? null,
    paymentMethod: order.paymentMethod ?? null,
    createdById: input.userId,
    statusRole: input.statusRole,
  });
  await syncCustomerStats(tx, existing?.customerId, input.saleStatuses);
  if (customer?.id !== existing?.customerId) await syncCustomerStats(tx, customer?.id, input.saleStatuses);
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: existing ? 'IMPORT_UPDATE' : 'IMPORT_CREATE',
      entity: 'Order',
      entityId: orderId,
      metadata: {
        orderNumber: order.orderNumber,
        lines: lineData.length,
        gross,
        discount,
        deliveryFee: order.deliveryFee,
        paymentMode: financeMode,
        paymentPartyKey: order.paymentPartyKey ?? null,
        paymentAccountKey: order.paymentAccountKey ?? null,
        inventorySyncMode: order.inventorySyncMode,
      },
    },
  });
  return {
    inserted: !existing,
    productIds: [...new Set([
      ...lineData.map((line) => line.productId),
      ...(existing?.lines.map((line) => line.productId) ?? []),
    ])],
  };
}
