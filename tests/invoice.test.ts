import { describe, expect, it } from 'vitest';
import { invoicePaymentSnapshot, invoiceTotal, type InvoiceFinanceEntryLike, type InvoiceOrderLike } from '@/lib/invoice';

const order = (over: Partial<InvoiceOrderLike> = {}): InvoiceOrderLike => ({
  id: 'ord1',
  status: 'COMPLETED',
  grossAmount: 100_000,
  discountAmount: 10_000,
  refundAmount: 0,
  deliveryFee: 3_000,
  extraCharges: 2_000,
  ...over,
});

const entry = (over: Partial<InvoiceFinanceEntryLike> & Pick<InvoiceFinanceEntryLike, 'id' | 'type' | 'amount'>): InvoiceFinanceEntryLike => ({
  orderId: 'ord1',
  obligation: false,
  obligationKind: null,
  settlesId: null,
  ...over,
});

describe('invoice helpers', () => {
  it('calculates invoice total from order totals', () => {
    expect(invoiceTotal(order())).toBe(95_000);
  });

  it('marks a direct paid invoice as paid', () => {
    const snapshot = invoicePaymentSnapshot(order(), [entry({ id: 'pay', type: 'INCOME', amount: 95_000 })]);
    expect(snapshot.status).toBe('PAID');
    expect(snapshot.paid).toBe(95_000);
    expect(snapshot.remaining).toBe(0);
  });

  it('marks a receivable with no payments as unpaid', () => {
    const snapshot = invoicePaymentSnapshot(order(), [
      entry({ id: 'ar', type: 'INCOME', amount: 95_000, obligation: true, obligationKind: 'RECEIVABLE', orderId: 'ord1' }),
    ]);
    expect(snapshot.status).toBe('UNPAID');
    expect(snapshot.remaining).toBe(95_000);
  });

  it('tracks multiple payments against one receivable as partial then paid', () => {
    const base = entry({ id: 'ar', type: 'INCOME', amount: 95_000, obligation: true, obligationKind: 'RECEIVABLE', orderId: 'ord1' });
    const partial = invoicePaymentSnapshot(order(), [
      base,
      entry({ id: 'p1', type: 'PAYMENT_IN', amount: 40_000, orderId: null, settlesId: 'ar' }),
      entry({ id: 'p2', type: 'PAYMENT_IN', amount: 30_000, orderId: null, settlesId: 'ar' }),
    ]);
    expect(partial.status).toBe('PARTIAL');
    expect(partial.paid).toBe(70_000);
    expect(partial.remaining).toBe(25_000);

    const paid = invoicePaymentSnapshot(order(), [
      base,
      entry({ id: 'p1', type: 'PAYMENT_IN', amount: 40_000, orderId: null, settlesId: 'ar' }),
      entry({ id: 'p2', type: 'PAYMENT_IN', amount: 55_000, orderId: null, settlesId: 'ar' }),
    ]);
    expect(paid.status).toBe('PAID');
    expect(paid.remaining).toBe(0);
  });

  it('uses order status for canceled and refunded invoices', () => {
    expect(invoicePaymentSnapshot(order({ status: 'CANCELLED' }), []).status).toBe('CANCELED');
    expect(invoicePaymentSnapshot(order({ status: 'REFUNDED', refundAmount: 95_000 }), []).status).toBe('REFUNDED');
  });

  it('ignores archived and reversed payment entries', () => {
    const snapshot = invoicePaymentSnapshot(order(), [
      entry({ id: 'ar', type: 'INCOME', amount: 95_000, obligation: true, obligationKind: 'RECEIVABLE', orderId: 'ord1' }),
      entry({ id: 'archived', type: 'PAYMENT_IN', amount: 95_000, orderId: null, settlesId: 'ar', archivedAt: new Date('2026-06-01') }),
      entry({ id: 'reversed', type: 'PAYMENT_IN', amount: 95_000, orderId: null, settlesId: 'ar', reversedAt: new Date('2026-06-02') }),
    ]);
    expect(snapshot.status).toBe('UNPAID');
    expect(snapshot.paid).toBe(0);
  });
});
