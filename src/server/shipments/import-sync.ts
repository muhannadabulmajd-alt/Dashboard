import 'server-only';
import type { Prisma } from '@prisma/client';
import type { ShipmentInput } from '@/server/ingestion/parsers';

type Tx = Prisma.TransactionClient;

async function closeShippingCost(tx: Tx, importKey: string, reason: string): Promise<void> {
  const entry = await tx.financeEntry.findUnique({
    where: { importKey },
    include: { settlements: { select: { amount: true } } },
  });
  if (!entry) return;
  const settled = entry.settlements.reduce((sum, settlement) => sum + settlement.amount, 0);
  if (settled > 0) {
    await tx.financeEntry.update({
      where: { id: entry.id },
      data: { amount: settled, description: reason },
    });
  } else {
    await tx.financeEntry.delete({ where: { id: entry.id } });
  }
}

export async function upsertImportedShipment(
  tx: Tx,
  shipment: ShipmentInput,
  input: { userId: string | null },
): Promise<boolean> {
  const order = await tx.order.findUnique({
    where: { orderNumber: shipment.orderNumber },
    select: { id: true, branchId: true, governorate: true, status: true },
  });
  if (!order) throw new Error(`unknown order ${shipment.orderNumber}`);

  const courierParty = shipment.courierPartyKey
    ? await tx.party.findUnique({ where: { externalKey: shipment.courierPartyKey }, select: { id: true } })
    : null;
  if (shipment.courierPartyKey && !courierParty) {
    throw new Error(`${shipment.orderNumber}: unknown courier party key ${shipment.courierPartyKey}`);
  }

  const existing = await tx.shipment.findUnique({ where: { orderId: order.id }, select: { id: true } });
  const data = {
    courier: shipment.courier ?? 'Courier',
    courierPartyId: courierParty?.id ?? null,
    status: shipment.status,
    governorate: shipment.governorate ?? order.governorate,
    shippingCost: shipment.shippingCost,
    dispatchedAt: shipment.dispatchedAt ?? null,
    deliveredAt: shipment.deliveredAt ?? null,
    failureReason: shipment.failureReason ?? null,
  };
  if (existing) await tx.shipment.update({ where: { id: existing.id }, data });
  else await tx.shipment.create({ data: { orderId: order.id, ...data } });
  await tx.order.update({ where: { id: order.id }, data: { deliveryCost: shipment.shippingCost } });

  const costKey = `SHIP:${order.id}:COST`;
  const shouldPost = shipment.status === 'DELIVERED'
    && shipment.financeMode === 'PAYABLE'
    && shipment.shippingCost > 0;
  if (!shouldPost) {
    await closeShippingCost(tx, costKey, `Closed shipping cost for ${shipment.orderNumber}`);
  } else {
    if (!courierParty) throw new Error(`${shipment.orderNumber}: courier party is required for a payable`);
    await tx.financeEntry.upsert({
      where: { importKey: costKey },
      create: {
        importKey: costKey,
        date: shipment.deliveredAt ?? shipment.dispatchedAt ?? new Date(),
        type: 'EXPENSE',
        recordClass: 'EXPENSE',
        amount: shipment.shippingCost,
        currency: 'IQD',
        obligation: true,
        obligationKind: 'PAYABLE',
        dueDate: shipment.deliveredAt ?? shipment.dispatchedAt ?? new Date(),
        partyId: courierParty.id,
        categoryType: 'SHIPPING',
        branchId: order.branchId,
        orderId: order.id,
        reference: shipment.orderNumber,
        description: `Delivery cost: ${shipment.orderNumber}`,
        createdById: input.userId,
      },
      update: {
        date: shipment.deliveredAt ?? shipment.dispatchedAt ?? new Date(),
        type: 'EXPENSE',
        recordClass: 'EXPENSE',
        amount: shipment.shippingCost,
        obligation: true,
        obligationKind: 'PAYABLE',
        dueDate: shipment.deliveredAt ?? shipment.dispatchedAt ?? new Date(),
        partyId: courierParty.id,
        categoryType: 'SHIPPING',
        branchId: order.branchId,
        orderId: order.id,
        reference: shipment.orderNumber,
        description: `Delivery cost: ${shipment.orderNumber}`,
        archivedAt: null,
        archiveReason: null,
      },
    });
  }
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: existing ? 'IMPORT_UPDATE' : 'IMPORT_CREATE',
      entity: 'Shipment',
      entityId: existing?.id ?? order.id,
      metadata: {
        orderNumber: shipment.orderNumber,
        status: shipment.status,
        shippingCost: shipment.shippingCost,
        courierPartyKey: shipment.courierPartyKey ?? null,
        financeMode: shipment.financeMode,
      },
    },
  });
  return !existing;
}
