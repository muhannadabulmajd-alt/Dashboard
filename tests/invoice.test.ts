import { describe, expect, it } from 'vitest';
import {
  groupInvoiceFinanceEntries,
  invoicePaymentSnapshot,
  invoiceTotal,
  type InvoiceFinanceEntryLike,
  type InvoiceOrderLike,
} from '@/lib/invoice';
import { getInvoiceLabels } from '@/server/invoice/labels';

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
  it('loads bilingual PDF labels without a request context', async () => {
    const [english, arabic] = await Promise.all([
      getInvoiceLabels('en'),
      getInvoiceLabels('ar'),
    ]);

    expect(english.title).toBeTruthy();
    expect(arabic.title).toBeTruthy();
    expect(english['paymentStatus.PAID']).toBeTruthy();
    expect(arabic['paymentStatus.PAID']).toBeTruthy();
  });

  it('calculates invoice total from order totals', () => {
    expect(invoiceTotal(order())).toBe(95_000);
  });

  it('marks a direct paid invoice as paid', () => {
    const paidAt = new Date('2026-07-28T09:00:00.000Z');
    const snapshot = invoicePaymentSnapshot(order(), [
      entry({
        id: 'pay',
        type: 'INCOME',
        amount: 95_000,
        date: paidAt,
        paymentMethod: 'CASH',
        account: { name: 'Cash on Hands' },
      }),
    ]);
    expect(snapshot.status).toBe('PAID');
    expect(snapshot.paid).toBe(95_000);
    expect(snapshot.remaining).toBe(0);
    expect(snapshot.route).toBe('DIRECT');
    expect(snapshot.accountName).toBe('Cash on Hands');
    expect(snapshot.paymentMethod).toBe('CASH');
    expect(snapshot.paymentDate).toEqual(paidAt);
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
    const canceled = invoicePaymentSnapshot(order({ status: 'CANCELLED' }), []);
    const refunded = invoicePaymentSnapshot(order({ status: 'REFUNDED', refundAmount: 95_000 }), []);
    expect(canceled.status).toBe('CANCELED');
    expect(canceled.remaining).toBe(0);
    expect(refunded.status).toBe('REFUNDED');
    expect(refunded.remaining).toBe(0);
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

  it('treats provider collection as customer payment while tracking remittance separately', () => {
    const providerReceivable = entry({
      id: 'provider-ar',
      type: 'INCOME',
      amount: 95_000,
      obligation: true,
      obligationKind: 'RECEIVABLE',
      party: { id: 'hi', name: 'Hi-Express', collectsOrderPayments: true },
    });
    const collected = invoicePaymentSnapshot(order(), [providerReceivable]);
    expect(collected.status).toBe('PAID');
    expect(collected.route).toBe('PROVIDER');
    expect(collected.paid).toBe(95_000);
    expect(collected.providerOutstanding).toBe(95_000);

    const remitted = invoicePaymentSnapshot(order(), [
      providerReceivable,
      entry({
        id: 'provider-cash',
        type: 'PAYMENT_IN',
        amount: 80_000,
        orderId: 'ord1',
        settlesId: 'provider-ar',
        account: { name: 'Cash on Hands' },
      }),
      entry({
        id: 'provider-fee',
        type: 'PAYMENT_IN',
        amount: 15_000,
        orderId: 'ord1',
        settlesId: 'provider-ar',
      }),
    ]);
    expect(remitted.paid).toBe(95_000);
    expect(remitted.providerCollected).toBe(95_000);
    expect(remitted.providerRemitted).toBe(80_000);
    expect(remitted.providerFeesOffset).toBe(15_000);
    expect(remitted.providerCleared).toBe(95_000);
    expect(remitted.providerOutstanding).toBe(0);
  });

  it('counts an automatically deposited provider collection exactly once', () => {
    const paidAt = new Date('2026-07-28T09:00:00.000Z');
    const snapshot = invoicePaymentSnapshot(order(), [
      entry({
        id: 'wayl-auto-deposit',
        type: 'INCOME',
        amount: 95_000,
        date: paidAt,
        paymentMethod: 'ONLINE_PAYMENT',
        account: { name: 'FIB' },
        party: {
          id: 'wayl',
          name: 'Wayl',
          collectsOrderPayments: true,
        },
      }),
    ]);

    expect(snapshot.status).toBe('PAID');
    expect(snapshot.route).toBe('PROVIDER');
    expect(snapshot.paid).toBe(95_000);
    expect(snapshot.paidRaw).toBe(95_000);
    expect(snapshot.providerCollected).toBe(95_000);
    expect(snapshot.providerRemitted).toBe(95_000);
    expect(snapshot.providerOutstanding).toBe(0);
    expect(snapshot.accountName).toBe('FIB');
  });

  it('counts a statement-matched provider settlement exactly once', () => {
    const customerReceivable = entry({
      id: 'customer-ar',
      type: 'INCOME',
      amount: 95_000,
      obligation: true,
      obligationKind: 'RECEIVABLE',
    });
    const statementPayment = entry({
      id: 'wayl-statement-payment',
      type: 'PAYMENT_IN',
      amount: 95_000,
      orderId: 'ord1',
      settlesId: 'customer-ar',
      account: { name: 'Wayl clearing wallet' },
      party: {
        id: 'wayl',
        name: 'Wayl',
        collectsOrderPayments: true,
      },
    });
    const snapshot = invoicePaymentSnapshot(order(), [customerReceivable, statementPayment]);

    expect(snapshot.status).toBe('PAID');
    expect(snapshot.route).toBe('PROVIDER');
    expect(snapshot.paidRaw).toBe(95_000);
    expect(snapshot.providerCollected).toBe(95_000);
    expect(snapshot.providerRemitted).toBe(95_000);
    expect(snapshot.providerOutstanding).toBe(0);
    expect(snapshot.accountName).toBe('Wayl clearing wallet');
  });

  it('counts an order-linked statement receipt without a legacy receivable', () => {
    const snapshot = invoicePaymentSnapshot(order(), [
      entry({
        id: 'wayl-statement-payment',
        type: 'PAYMENT_IN',
        amount: 95_000,
        orderId: 'ord1',
        account: { name: 'Wayl clearing wallet' },
        party: {
          id: 'wayl',
          name: 'Wayl',
          collectsOrderPayments: true,
        },
      }),
    ]);

    expect(snapshot.status).toBe('PAID');
    expect(snapshot.route).toBe('PROVIDER');
    expect(snapshot.paidRaw).toBe(95_000);
    expect(snapshot.providerCollected).toBe(95_000);
    expect(snapshot.providerRemitted).toBe(95_000);
    expect(snapshot.providerOutstanding).toBe(0);
  });

  it('supports a direct partial payment followed by provider collection for the balance', () => {
    const snapshot = invoicePaymentSnapshot(order(), [
      entry({
        id: 'customer-ar',
        type: 'INCOME',
        amount: 30_000,
        obligation: true,
        obligationKind: 'RECEIVABLE',
      }),
      entry({ id: 'deposit', type: 'PAYMENT_IN', amount: 30_000, orderId: null, settlesId: 'customer-ar' }),
      entry({
        id: 'provider-ar',
        type: 'INCOME',
        amount: 65_000,
        obligation: true,
        obligationKind: 'RECEIVABLE',
        party: { id: 'wayl', name: 'Wayl', collectsOrderPayments: true },
      }),
    ]);
    expect(snapshot.status).toBe('PAID');
    expect(snapshot.paidRaw).toBe(95_000);
    expect(snapshot.route).toBe('PROVIDER');
    expect(snapshot.providerOutstanding).toBe(65_000);
  });

  it('groups obligations and their settlement rows in one pass', () => {
    const rows = [
      entry({ id: 'ar-1', type: 'INCOME', amount: 95_000, obligation: true, obligationKind: 'RECEIVABLE' }),
      entry({ id: 'settle-1', type: 'PAYMENT_IN', amount: 95_000, orderId: null, settlesId: 'ar-1' }),
      entry({ id: 'pay-2', type: 'INCOME', amount: 10_000, orderId: 'ord2' }),
    ];
    const grouped = groupInvoiceFinanceEntries(rows);
    expect(grouped.get('ord1')?.map((row) => row.id)).toEqual(['ar-1', 'settle-1']);
    expect(grouped.get('ord2')?.map((row) => row.id)).toEqual(['pay-2']);
  });

  it('caps display payment while retaining raw overpayment for reconciliation', () => {
    const snapshot = invoicePaymentSnapshot(order(), [
      entry({ id: 'pay', type: 'INCOME', amount: 100_000 }),
    ]);
    expect(snapshot.paid).toBe(95_000);
    expect(snapshot.paidRaw).toBe(100_000);
    expect(snapshot.remaining).toBe(0);
  });
});
