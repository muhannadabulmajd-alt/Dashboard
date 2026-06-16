import 'server-only';
import { prisma } from '@/server/db/client';
import { invoicePaymentSnapshot } from '@/lib/invoice';

export async function getInvoiceData(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      branch: true,
      createdBy: { select: { name: true, email: true } },
      lines: { orderBy: { id: 'asc' }, include: { product: true } },
    },
  });
  if (!order) return null;

  const financeEntries = await prisma.financeEntry.findMany({
    where: {
      OR: [{ orderId }, { settles: { is: { orderId } } }],
    },
    include: {
      account: { select: { name: true, currency: true } },
      party: { select: { name: true } },
      settles: { select: { id: true, orderId: true, reference: true } },
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });

  const payment = invoicePaymentSnapshot(order, financeEntries);
  return { order, financeEntries, payment };
}

export type InvoiceData = NonNullable<Awaited<ReturnType<typeof getInvoiceData>>>;
