'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { FINANCE_TYPES, CURRENCIES, OBLIGATION_KINDS, EXPENSE_CATEGORY_TYPES } from '@/lib/enums';
import { toMinor, convertToIqd } from '@/lib/money';
import { getUsdToIqd } from '@/server/settings';
import { requireCap, audit, reqField, optField, type ActionState } from '@/server/records/shared';

const HUB = '/[locale]/(dashboard)/finance';
const LIST = '/[locale]/(dashboard)/finance/ledger';
const CAP = 'manage:finance' as const;

const schema = z.object({
  type: z.enum(FINANCE_TYPES),
  amount: z.coerce.number().positive(), // major units; converted to minor on save
  currency: z.enum(CURRENCIES), // payment currency; the stored entry is always IQD
  rate: z.coerce.number().positive().optional(), // IQD per $1, used only when paid in USD
  date: z.coerce.date(),
  accountId: z.string().optional(),
  toAccountId: z.string().optional(),
  partyId: z.string().optional(),
  categoryType: z.enum(EXPENSE_CATEGORY_TYPES).optional(),
  obligationKind: z.enum(OBLIGATION_KINDS).optional(),
  dueDate: z.coerce.date().optional(),
  branchId: z.string().optional(),
  description: z.string().optional(),
  reference: z.string().optional(),
  attachmentUrl: z.string().optional(),
  settlesId: z.string().optional(),
});

type Parsed = z.infer<typeof schema>;

function parse(fd: FormData) {
  const obligation = reqField(fd, 'obligation') === 'yes';
  const res = schema.safeParse({
    type: reqField(fd, 'type'),
    amount: reqField(fd, 'amount'),
    currency: reqField(fd, 'currency'),
    rate: optField(fd, 'rate'),
    date: reqField(fd, 'date'),
    accountId: optField(fd, 'accountId'),
    toAccountId: optField(fd, 'toAccountId'),
    partyId: optField(fd, 'partyId'),
    categoryType: optField(fd, 'categoryType'),
    obligationKind: optField(fd, 'obligationKind'),
    dueDate: optField(fd, 'dueDate'),
    branchId: optField(fd, 'branchId'),
    description: optField(fd, 'description'),
    reference: optField(fd, 'reference'),
    attachmentUrl: optField(fd, 'attachmentUrl'),
    settlesId: optField(fd, 'settlesId'),
  });
  return { obligation, res };
}

/** Validate the type/obligation/account combination and shape the row. */
function toData(p: Parsed, obligation: boolean, fallbackRate: number) {
  if (obligation) {
    if (!p.obligationKind) return null; // a due needs payable/receivable
  } else if (p.type === 'TRANSFER') {
    if (!p.accountId || !p.toAccountId || p.accountId === p.toAccountId) return null;
  } else if (!p.accountId) {
    return null; // a cash movement needs an account
  }
  // Everything is stored in IQD. A USD payment is converted at the entry's rate
  // (falling back to the configured rate), keeping the original for the record.
  const payMinor = toMinor(p.amount, p.currency);
  const usd = p.currency === 'USD';
  const rate = usd ? Math.round(p.rate ?? fallbackRate) : null;
  return {
    date: p.date,
    type: p.type,
    amount: usd ? convertToIqd(payMinor, 'USD', rate as number) : payMinor,
    currency: 'IQD' as const,
    origCurrency: usd ? ('USD' as const) : null,
    origAmount: usd ? payMinor : null,
    fxRate: rate,
    obligation,
    obligationKind: obligation ? (p.obligationKind ?? null) : null,
    dueDate: obligation ? (p.dueDate ?? null) : null,
    accountId: obligation ? null : (p.accountId ?? null),
    toAccountId: !obligation && p.type === 'TRANSFER' ? (p.toAccountId ?? null) : null,
    partyId: p.partyId ?? null,
    categoryType: p.type === 'EXPENSE' || p.type === 'PURCHASE' ? (p.categoryType ?? null) : null,
    settlesId: p.settlesId ?? null,
    branchId: p.branchId ?? null,
    description: p.description ?? null,
    reference: p.reference ?? null,
    attachmentUrl: p.attachmentUrl ?? null,
  };
}

export async function createEntry(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const { obligation, res } = parse(fd);
  if (!res.success) return { error: 'invalid' };
  const data = toData(res.data, obligation, await getUsdToIqd());
  if (!data) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  const row = await prisma.financeEntry.create({ data: { ...data, createdById: user.id } });
  await audit(user.id, 'CREATE', 'FinanceEntry', { type: data.type, amount: data.amount });
  revalidatePath(HUB, 'page');
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/finance/ledger/${row.id}`);
}

export async function updateEntry(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const { obligation, res } = parse(fd);
  if (!res.success) return { error: 'invalid' };
  const data = toData(res.data, obligation, await getUsdToIqd());
  if (!data) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  await prisma.financeEntry.update({ where: { id }, data });
  await audit(user.id, 'UPDATE', 'FinanceEntry', { id });
  revalidatePath(HUB, 'page');
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/finance/ledger/${id}`);
}

export async function reverseEntry(id: string, locale: string): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  const entry = await prisma.financeEntry.findUnique({
    where: { id },
    include: { settlements: { where: { reversedAt: null, reversalOfId: null }, select: { id: true } } },
  });
  if (!entry || entry.importKey || entry.reversedAt || entry.reversalOfId) redirect(`/${locale}/finance/ledger/${id}`);
  if (entry.obligation && entry.settlements.length > 0) {
    redirect(`/${locale}/finance/ledger/${id}`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.financeEntry.update({
      where: { id },
      data: {
        reversedAt: new Date(),
        reversedById: user.id,
        reversalReason: 'Manual reversal',
      },
    });
    await tx.financeEntry.create({
      data: {
        date: new Date(),
        type: entry.type,
        amount: entry.amount,
        currency: entry.currency,
        origCurrency: entry.origCurrency,
        origAmount: entry.origAmount,
        fxRate: entry.fxRate,
        obligation: entry.obligation,
        obligationKind: entry.obligationKind,
        dueDate: entry.dueDate,
        accountId: entry.accountId,
        toAccountId: entry.toAccountId,
        partyId: entry.partyId,
        categoryType: entry.categoryType,
        settlesId: entry.settlesId,
        branchId: entry.branchId,
        orderId: entry.orderId,
        reference: entry.reference,
        attachmentUrl: entry.attachmentUrl,
        description: `Reversal marker for ${entry.reference ?? entry.id}`,
        reversalOfId: entry.id,
        createdById: user.id,
      },
    });
  });
  await audit(user.id, 'REVERSE', 'FinanceEntry', { id });
  revalidatePath(HUB, 'page');
  revalidatePath(LIST, 'page');
  revalidatePath('/[locale]/(dashboard)/finance/dues', 'page');
  redirect(`/${locale}/finance/ledger`);
}

export async function deleteEntry(id: string, locale: string): Promise<void> {
  await reverseEntry(id, locale);
}

const settleSchema = z.object({
  amount: z.coerce.number().positive(),
  accountId: z.string().min(1),
  date: z.coerce.date(),
});

/** Record a (partial) payment that settles a payable/receivable obligation. */
export async function settleEntry(
  obligationId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = settleSchema.safeParse({
    amount: reqField(fd, 'amount'),
    accountId: reqField(fd, 'accountId'),
    date: reqField(fd, 'date'),
  });
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';

  const ob = await prisma.financeEntry.findUnique({
    where: { id: obligationId },
    include: { settlements: { where: { reversedAt: null, reversalOfId: null }, select: { amount: true } } },
  });
  if (!ob || ob.reversedAt || ob.reversalOfId || !ob.obligation || !ob.obligationKind) return { error: 'invalid' };
  const paid = ob.settlements.reduce((s, x) => s + x.amount, 0);
  const outstanding = Math.max(0, ob.amount - paid);
  if (outstanding <= 0) return { error: 'invalid' };
  const amount = Math.min(toMinor(r.data.amount, ob.currency), outstanding);

  await prisma.financeEntry.create({
    data: {
      date: r.data.date,
      type: ob.obligationKind === 'PAYABLE' ? 'PAYMENT_OUT' : 'PAYMENT_IN',
      amount,
      currency: ob.currency,
      obligation: false,
      accountId: r.data.accountId,
      partyId: ob.partyId,
      settlesId: ob.id,
      branchId: ob.branchId,
      description: 'Settlement',
      createdById: user.id,
    },
  });
  await audit(user.id, 'SETTLE', 'FinanceEntry', { obligationId, amount });
  revalidatePath(HUB, 'page');
  revalidatePath(LIST, 'page');
  revalidatePath('/[locale]/(dashboard)/finance/dues', 'page');
  redirect(`/${locale}/finance/dues`);
}

/**
 * Set the paying account on imported (PUR:) purchases that have none, matching
 * the account's currency — so cash balances reflect historical spend.
 */
export async function assignImportedAccount(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const accountId = reqField(fd, 'accountId');
  const locale = reqField(fd, 'locale') || 'ar';
  if (!accountId) return { error: 'invalid' };
  const account = await prisma.financeAccount.findUnique({ where: { id: accountId }, select: { currency: true } });
  if (!account) return { error: 'invalid' };
  await prisma.financeEntry.updateMany({
    where: {
      importKey: { startsWith: 'PUR:' },
      currency: account.currency,
      accountId: null,
      obligation: false,
      reversedAt: null,
      reversalOfId: null,
    },
    data: { accountId },
  });
  await audit(user.id, 'ASSIGN_ACCOUNT', 'FinanceEntry', { accountId, currency: account.currency });
  revalidatePath(HUB, 'page');
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/finance/ledger`);
}
