import 'server-only';
import { prisma } from '@/server/db/client';
import { convertToIqd } from '@/lib/money';
import { getUsdToIqd } from '@/server/settings';
import type { AppLocale } from '@/lib/money';
import type { ResolvedRange } from '@/lib/dates';
import type { Currency } from '@prisma/client';

type Scope = { branchId?: string };

export interface PartyStatementEntry {
  id: string;
  date: Date;
  type: string;
  description: string;
  reference: string | null;
  charge: number;
  payment: number;
  balance: number;
}

export interface PartyStatementData {
  party: {
    id: string;
    name: string;
    type: string;
    phone: string | null;
    email: string | null;
    address: string | null;
  };
  locale: AppLocale;
  range: ResolvedRange;
  opening: number;
  charges: number;
  payments: number;
  closing: number;
  entries: PartyStatementEntry[];
}

function statementEffect(
  partyType: string,
  entry: {
    type: string;
    amount: number;
    currency: string;
    obligation: boolean;
    obligationKind: string | null;
  },
  rate: number,
): { charge: number; payment: number } {
  const amount = convertToIqd(entry.amount, entry.currency as Currency, rate);
  if (partyType === 'CUSTOMER') {
    if (entry.obligation && entry.obligationKind === 'RECEIVABLE') return { charge: amount, payment: 0 };
    if (entry.type === 'PAYMENT_IN') return { charge: 0, payment: amount };
  } else {
    if (entry.obligation && entry.obligationKind === 'PAYABLE') return { charge: amount, payment: 0 };
    if (entry.type === 'PAYMENT_OUT') return { charge: 0, payment: amount };
  }
  return { charge: 0, payment: 0 };
}

export async function getPartyStatementData(
  id: string,
  locale: AppLocale,
  range: ResolvedRange,
  scope: Scope,
): Promise<PartyStatementData | null> {
  const branchWhere = scope.branchId ? { branchId: scope.branchId } : {};
  const [party, entries, rate] = await Promise.all([
    prisma.party.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        type: true,
        phone: true,
        email: true,
        address: true,
        openingPayable: true,
        openingReceivable: true,
      },
    }),
    prisma.financeEntry.findMany({
      where: {
        OR: [{ partyId: id }, { settles: { is: { partyId: id } } }],
        date: { lte: range.end },
        archivedAt: null,
        reversedAt: null,
        reversalOfId: null,
        ...branchWhere,
      },
      select: {
        id: true,
        date: true,
        type: true,
        amount: true,
        currency: true,
        obligation: true,
        obligationKind: true,
        description: true,
        reference: true,
      },
      orderBy: { date: 'asc' },
    }),
    getUsdToIqd(),
  ]);
  if (!party) return null;

  const isCustomer = party.type === 'CUSTOMER';
  let opening = isCustomer
    ? party.openingReceivable - party.openingPayable
    : party.openingPayable - party.openingReceivable;
  let periodBalance = opening;
  let charges = 0;
  let payments = 0;
  const rows: PartyStatementEntry[] = [];

  for (const entry of entries) {
    const effect = statementEffect(party.type, entry, rate);
    if (effect.charge === 0 && effect.payment === 0) continue;
    if (entry.date < range.start) {
      opening += effect.charge - effect.payment;
      periodBalance += effect.charge - effect.payment;
      continue;
    }
    charges += effect.charge;
    payments += effect.payment;
    periodBalance += effect.charge - effect.payment;
    rows.push({
      id: entry.id,
      date: entry.date,
      type: entry.type,
      description: entry.description ?? entry.reference ?? entry.id,
      reference: entry.reference,
      charge: effect.charge,
      payment: effect.payment,
      balance: periodBalance,
    });
  }

  return {
    party,
    locale,
    range,
    opening,
    charges,
    payments,
    closing: opening + charges - payments,
    entries: rows,
  };
}
