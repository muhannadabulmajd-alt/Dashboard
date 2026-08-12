'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { toMinor } from '@/lib/money';
import { allocateProviderDeposit } from '@/lib/provider-settlement';
import { audit, optField, reqField, requireCap, type ActionState } from '@/server/records/shared';

const schema = z.object({
  partyKey: z.string().min(1),
  accountId: z.string().min(1),
  amountReceived: z.coerce.number().positive(),
  date: z.coerce.date(),
  paymentMethod: z.string().optional(),
  reference: z.string().optional(),
});

export async function settleProvider(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap('manage:finance');
  if (!user) return { error: 'forbidden' };
  const parsed = schema.safeParse({
    partyKey: reqField(fd, 'partyKey'),
    accountId: reqField(fd, 'accountId'),
    amountReceived: reqField(fd, 'amountReceived'),
    date: reqField(fd, 'date'),
    paymentMethod: optField(fd, 'paymentMethod'),
    reference: optField(fd, 'reference'),
  });
  if (!parsed.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  const input = parsed.data;
  const amountReceived = toMinor(input.amountReceived, 'IQD');
  try {
    const summary = await prisma.$transaction(async (tx) => {
      const party = await tx.party.findUnique({
        where: { externalKey: input.partyKey },
        select: {
          id: true,
          isActive: true,
          collectsOrderPayments: true,
          netFeesFromRemittance: true,
          defaultSettlementAccountId: true,
          defaultSettlementAccount: {
            select: { id: true, currency: true, type: true, isActive: true },
          },
        },
      });
      if (
        !party?.isActive ||
        !party.collectsOrderPayments ||
        !party.defaultSettlementAccount?.isActive ||
        party.defaultSettlementAccount.currency !== 'IQD' ||
        party.defaultSettlementAccount.type === 'PAYMENT_GATEWAY'
      ) throw new Error('provider');
      const account = await tx.financeAccount.findUnique({
        where: { id: input.accountId },
        select: { id: true, currency: true, type: true, isActive: true },
      });
      if (!account?.isActive || account.currency !== 'IQD' || account.type === 'PAYMENT_GATEWAY') {
        throw new Error('account');
      }
      if (party.defaultSettlementAccountId && party.defaultSettlementAccountId !== account.id) throw new Error('account');

      const obligations = await tx.financeEntry.findMany({
        where: {
          partyId: party.id,
          obligation: true,
          archivedAt: null,
          reversedAt: null,
          reversalOfId: null,
        },
        include: {
          settlements: {
            where: { archivedAt: null, reversedAt: null, reversalOfId: null },
            select: { amount: true },
          },
        },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      });
      const open = obligations.map((obligation) => ({
        obligation,
        outstanding: Math.max(0, obligation.amount - obligation.settlements.reduce((sum, row) => sum + row.amount, 0)),
      })).filter((row) => row.outstanding > 0);
      const receivables = open.filter((row) => row.obligation.obligationKind === 'RECEIVABLE' && row.obligation.orderId);
      const payablesByOrder = new Map(open
        .filter((row) => row.obligation.obligationKind === 'PAYABLE' && row.obligation.orderId)
        .map((row) => [row.obligation.orderId as string, row]));
      const allocations = allocateProviderDeposit(receivables.map((row) => {
        const fee = payablesByOrder.get(row.obligation.orderId as string);
        return {
          orderId: row.obligation.orderId as string,
          receivableId: row.obligation.id,
          receivableOutstanding: row.outstanding,
          feePayableId: fee?.obligation.id ?? null,
          feeOutstanding: fee?.outstanding ?? 0,
        };
      }), amountReceived, party.netFeesFromRemittance);
      if (!allocations.length) throw new Error('amount');

      const feesOffset = allocations.reduce((sum, row) => sum + row.feeOffset, 0);
      const grossCleared = allocations.reduce((sum, row) => sum + row.grossCleared, 0);
      const settlement = await tx.providerSettlement.create({
        data: {
          providerPartyId: party.id,
          accountId: account.id,
          date: input.date,
          grossCleared,
          feesOffset,
          amountReceived,
          paymentMethod: input.paymentMethod ?? null,
          reference: input.reference ?? null,
          createdById: user.id,
        },
      });
      for (const allocation of allocations) {
        const obligation = receivables.find((row) => row.obligation.id === allocation.receivableId)?.obligation;
        if (!obligation) continue;
        if (allocation.cashApplied > 0) {
          await tx.financeEntry.create({
            data: {
              date: input.date,
              type: 'PAYMENT_IN',
              amount: allocation.cashApplied,
              currency: 'IQD',
              obligation: false,
              accountId: account.id,
              partyId: party.id,
              paymentMethod: input.paymentMethod ?? null,
              settlesId: obligation.id,
              branchId: obligation.branchId,
              orderId: obligation.orderId,
              providerSettlementId: settlement.id,
              description: `${input.partyKey} settlement`,
              createdById: user.id,
            },
          });
        }
        if (allocation.feeOffset > 0 && allocation.feePayableId) {
          await tx.financeEntry.createMany({ data: [{
            date: input.date,
            type: 'PAYMENT_IN',
            amount: allocation.feeOffset,
            currency: 'IQD',
            obligation: false,
            accountId: null,
            partyId: party.id,
            paymentMethod: input.paymentMethod ?? null,
            settlesId: obligation.id,
            branchId: obligation.branchId,
            orderId: obligation.orderId,
            providerSettlementId: settlement.id,
            description: `${input.partyKey} fee offset`,
            createdById: user.id,
          }, {
            date: input.date,
            type: 'PAYMENT_OUT',
            amount: allocation.feeOffset,
            currency: 'IQD',
            obligation: false,
            accountId: null,
            partyId: party.id,
            paymentMethod: input.paymentMethod ?? null,
            settlesId: allocation.feePayableId,
            branchId: obligation.branchId,
            orderId: obligation.orderId,
            providerSettlementId: settlement.id,
            description: `${input.partyKey} fee offset`,
            createdById: user.id,
          }] });
        }
      }
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'PROVIDER_SETTLEMENT',
          entity: 'ProviderSettlement',
          entityId: settlement.id,
          metadata: { partyKey: input.partyKey, grossCleared, feesOffset, amountReceived, orders: allocations.length },
        },
      });
      return { id: settlement.id, partyId: party.id, grossCleared, feesOffset, amountReceived, orders: allocations.length };
    }, { timeout: 60_000 });
    await audit(user.id, 'PROVIDER_SETTLEMENT_COMPLETE', 'Party', summary);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'invalid' };
  }
  revalidatePath('/[locale]/(dashboard)/finance', 'page');
  revalidatePath('/[locale]/(dashboard)/finance/dues', 'page');
  revalidatePath('/[locale]/(dashboard)/admin/records/orders', 'page');
  redirect(`/${locale}/finance/dues`);
}
