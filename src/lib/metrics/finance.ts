import type { FinanceType, ObligationKind, Currency } from '@prisma/client';

/** Structural view of a finance entry (keeps this module Prisma-runtime-free). */
export interface FinanceEntryLike {
  id: string;
  type: FinanceType;
  amount: number;
  currency: Currency;
  obligation: boolean;
  obligationKind: ObligationKind | null;
  accountId: string | null;
  toAccountId: string | null;
  settlesId: string | null;
}

const IN_TYPES: FinanceType[] = ['INCOME', 'PAYMENT_IN', 'CAPITAL_IN'];
const OUT_TYPES: FinanceType[] = ['EXPENSE', 'PURCHASE', 'PAYMENT_OUT', 'DRAWING'];

/** A non-obligation entry tied to an account actually moves cash. */
export function isCashMovement(e: FinanceEntryLike): boolean {
  return !e.obligation && e.accountId != null;
}

/** Signed cash effect on `accountId` for a non-transfer entry. */
export function signedEffect(e: FinanceEntryLike): number {
  if (e.type === 'TRANSFER') return 0;
  if (IN_TYPES.includes(e.type)) return e.amount;
  if (OUT_TYPES.includes(e.type)) return -e.amount;
  return 0;
}

export interface AccountLike {
  id: string;
  openingBalance: number;
}

/** Current balance of one account = opening + all cash movements touching it. */
export function accountBalance(account: AccountLike, entries: FinanceEntryLike[]): number {
  let balance = account.openingBalance;
  for (const e of entries) {
    if (e.obligation) continue; // obligations don't move cash
    if (e.type === 'TRANSFER') {
      if (e.accountId === account.id) balance -= e.amount;
      if (e.toAccountId === account.id) balance += e.amount;
      continue;
    }
    if (e.accountId === account.id) balance += signedEffect(e);
  }
  return balance;
}

export interface FinanceTotals {
  capitalIn: number; // shareholder contributions received
  expenses: number; // EXPENSE + PURCHASE incurred (paid or still due)
  received: number; // money received from parties (payments + other income)
  cashIn: number; // all money in (incl. capital)
  cashOut: number; // all money out
  outstandingPayable: number; // we owe (dues not yet fully paid)
  outstandingReceivable: number; // owed to us
}

/**
 * Roll up a set of entries. Caller should pass a single-currency slice (IQD and
 * USD are never silently merged). Partial settlements reduce outstanding dues.
 */
export function financeTotals(entries: FinanceEntryLike[]): FinanceTotals {
  const paidByObligation = new Map<string, number>();
  for (const e of entries) {
    if (e.settlesId) paidByObligation.set(e.settlesId, (paidByObligation.get(e.settlesId) ?? 0) + e.amount);
  }

  const t: FinanceTotals = {
    capitalIn: 0,
    expenses: 0,
    received: 0,
    cashIn: 0,
    cashOut: 0,
    outstandingPayable: 0,
    outstandingReceivable: 0,
  };

  for (const e of entries) {
    if (e.type === 'EXPENSE' || e.type === 'PURCHASE') t.expenses += e.amount;
    if (e.type === 'CAPITAL_IN') t.capitalIn += e.amount; // capital counts even if the cash account is unknown (e.g. imports)
    if ((e.type === 'PAYMENT_IN' || e.type === 'INCOME') && isCashMovement(e)) t.received += e.amount;

    if (isCashMovement(e)) {
      const s = signedEffect(e);
      if (s > 0) t.cashIn += s;
      else if (s < 0) t.cashOut += -s;
    }

    if (e.obligation && e.obligationKind) {
      const outstanding = Math.max(0, e.amount - (paidByObligation.get(e.id) ?? 0));
      if (e.obligationKind === 'PAYABLE') t.outstandingPayable += outstanding;
      else t.outstandingReceivable += outstanding;
    }
  }
  return t;
}

export interface AgingInput {
  outstanding: number; // minor units still owed
  refDate: Date; // due date (preferred) or the entry date
}

export interface AgingBuckets {
  d0_30: number;
  d30_60: number;
  d60plus: number;
  total: number;
}

/** Bucket outstanding dues by age (days since refDate): 0–30, 30–60, 60+. */
export function agingBuckets(items: AgingInput[], asOf: Date): AgingBuckets {
  const DAY = 86_400_000;
  const b: AgingBuckets = { d0_30: 0, d30_60: 0, d60plus: 0, total: 0 };
  for (const it of items) {
    const days = Math.floor((asOf.getTime() - it.refDate.getTime()) / DAY);
    if (days <= 30) b.d0_30 += it.outstanding;
    else if (days <= 60) b.d30_60 += it.outstanding;
    else b.d60plus += it.outstanding;
    b.total += it.outstanding;
  }
  return b;
}

/** Net cash across accounts (sum of opening balances + movements). */
export function totalCash(accounts: AccountLike[], entries: FinanceEntryLike[]): number {
  return accounts.reduce((s, a) => s + accountBalance(a, entries), 0);
}

/**
 * Cash effect of non-obligation entries that aren't tied to a named account
 * (e.g. bulk-imported purchases/capital have no account). The data model treats
 * every `obligation=false` entry as a real cash movement, so this money is on
 * hand even though `accountBalance` — which is per-account — can't attribute it.
 */
export function unassignedCash(entries: FinanceEntryLike[]): number {
  let cash = 0;
  for (const e of entries) {
    if (e.obligation || e.accountId != null) continue; // dues + account-tied handled elsewhere
    if (e.type === 'TRANSFER') continue; // transfers always name accounts; nets out
    cash += signedEffect(e);
  }
  return cash;
}

/**
 * True cash on hand = opening balances + every non-obligation cash movement,
 * whether or not it names an account. Equals `totalCash` plus `unassignedCash`,
 * so a per-account breakdown reconciles to this when an "unassigned" line is
 * shown. Use this (not `totalCash`) for headline cash / balance-sheet assets.
 */
export function netCash(accounts: AccountLike[], entries: FinanceEntryLike[]): number {
  return totalCash(accounts, entries) + unassignedCash(entries);
}
