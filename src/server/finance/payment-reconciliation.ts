'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db/client';
import { requireCap } from '@/server/records/shared';
import { syncOrderCustomerBalance } from '@/server/finance/sync';

export async function linkPaymentReconciliationItem(
  reconciliationId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireCap('manage:finance');
  if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) throw new Error('forbidden');
  const orderId = String(formData.get('orderId') ?? '');
  if (!orderId) throw new Error('invalid');

  await prisma.$transaction(async (tx) => {
    const item = await tx.paymentReconciliationItem.findUnique({
      where: { id: reconciliationId },
      include: { receiptEntry: true, feeEntry: true },
    });
    const order = await tx.order.findUnique({
      where: { id: orderId },
    });
    if (!item || item.status !== 'NEEDS_ORDER' || !item.receiptEntry || !order) {
      throw new Error('invalid');
    }
    if (order.purpose !== 'SALE') throw new Error('invalid');
    const invoiceTotal = Math.max(
      0,
      order.grossAmount -
        order.discountAmount -
        order.refundAmount +
        order.deliveryFee +
        order.extraCharges,
    );
    if (invoiceTotal !== item.grossAmount) throw new Error('amount_mismatch');
    const alreadyLinked = await tx.paymentReconciliationItem.findFirst({
      where: { orderId, status: 'LINKED', id: { not: item.id } },
      select: { id: true },
    });
    if (alreadyLinked) throw new Error('already_linked');

    await syncOrderCustomerBalance(tx, orderId, {
      dueDate: order.placedAt,
      createdById: user.id,
    });
    const receivable = await tx.financeEntry.findFirst({
      where: {
        orderId,
        obligation: true,
        obligationKind: 'RECEIVABLE',
        archivedAt: null,
        reversedAt: null,
        reversalOfId: null,
      },
      orderBy: [{ party: { collectsOrderPayments: 'desc' } }, { createdAt: 'asc' }],
    });
    if (!receivable) throw new Error('receivable');

    await tx.financeEntry.updateMany({
      where: {
        orderId,
        costRole: 'PAYMENT_PROCESSING',
        id: { not: item.feeEntry?.id },
        archivedAt: null,
        reversedAt: null,
        reversalOfId: null,
      },
      data: {
        archivedAt: new Date(),
        archivedById: user.id,
        archiveReason: `Replaced by exact Wayl statement fee ${item.externalCode}`,
      },
    });
    await tx.financeEntry.update({
      where: { id: item.receiptEntry.id },
      data: {
        orderId,
        branchId: order.branchId,
        settlesId: receivable.id,
        description: `Wayl customer payment: ${order.orderNumber}`,
      },
    });
    if (item.feeEntry) {
      await tx.financeEntry.update({
        where: { id: item.feeEntry.id },
        data: { orderId, branchId: order.branchId },
      });
    }
    await tx.financeEntry.updateMany({
      where: { importKey: `WAYL:STATEMENT:${item.externalCode}:CUSTOMER_DEPOSIT` },
      data: {
        archivedAt: new Date(),
        archiveReason: `Linked to order ${order.orderNumber}`,
      },
    });
    await tx.paymentReconciliationItem.update({
      where: { id: item.id },
      data: { orderId, status: 'LINKED' },
    });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'LINK_PAYMENT_RECONCILIATION',
        entity: 'PaymentReconciliationItem',
        entityId: item.id,
        metadata: {
          externalCode: item.externalCode,
          orderId,
          orderNumber: order.orderNumber,
          grossAmount: item.grossAmount,
          feeAmount: item.feeAmount,
        },
      },
    });
  });

  revalidatePath('/[locale]/(dashboard)/finance/online-payments', 'page');
  revalidatePath('/[locale]/(dashboard)/finance', 'page');
  revalidatePath('/[locale]/(dashboard)/admin/records/orders/[id]', 'page');
}
