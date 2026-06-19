'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { toMinor } from '@/lib/money';
import { audit, optField, reqField, requireCap, type ActionState } from '@/server/records/shared';

const schema = z.object({
  partyKey: z.enum(['HI_EXPRESS', 'WAYL']),
  accountId: z.string().min(1),
  amountReceived: z.coerce.number().nonnegative(),
  date: z.coerce.date(),
  paymentMethod: z.string().optional(),
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
  });
  if (!parsed.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  const input = parsed.data;
  const amountReceived = toMinor(input.amountReceived, 'IQD');

  try {
    const summary = await prisma.$transaction(async (tx) => {
      const party = await tx.party.findUnique({ where: { externalKey: input.partyKey }, select: { id: true } });
      if (!party) throw new Error('provider');
      const account = await tx.financeAccount.findUnique({
        where: { id: input.accountId },
        select: { id: true, currency: true },
      });
      if (!account || account.currency !== 'IQD') throw new Error('account');
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
      const receivables = open.filter((row) => row.obligation.obligationKind === 'RECEIVABLE');
      const payables = open.filter((row) => row.obligation.obligationKind === 'PAYABLE');
      const receivableTotal = receivables.reduce((sum, row) => sum + row.outstanding, 0);
      const payableTotal = payables.reduce((sum, row) => sum + row.outstanding, 0);

      if (input.partyKey === 'HI_EXPRESS' && amountReceived !== Math.max(0, receivableTotal - payableTotal)) {
        throw new Error('amount');
      }
      if (input.partyKey === 'WAYL' && (payableTotal > 0 || amountReceived > receivableTotal)) {
        throw new Error('amount');
      }

      for (const row of receivables) {
        await tx.financeEntry.create({
          data: {
            date: input.date,
            type: 'PAYMENT_IN',
            amount: row.outstanding,
            currency: 'IQD',
            obligation: false,
            accountId: account.id,
            partyId: party.id,
            paymentMethod: input.paymentMethod ?? null,
            settlesId: row.obligation.id,
            branchId: row.obligation.branchId,
            orderId: row.obligation.orderId,
            description: `${input.partyKey} settlement`,
            createdById: user.id,
          },
        });
      }
      for (const row of payables) {
        await tx.financeEntry.create({
          data: {
            date: input.date,
            type: 'PAYMENT_OUT',
            amount: row.outstanding,
            currency: 'IQD',
            obligation: false,
            accountId: account.id,
            partyId: party.id,
            paymentMethod: input.paymentMethod ?? null,
            settlesId: row.obligation.id,
            branchId: row.obligation.branchId,
            orderId: row.obligation.orderId,
            description: `${input.partyKey} settlement`,
            createdById: user.id,
          },
        });
      }
      const commission = input.partyKey === 'WAYL' ? receivableTotal - amountReceived : 0;
      if (commission > 0) {
        await tx.financeEntry.create({
          data: {
            date: input.date,
            type: 'EXPENSE',
            recordClass: 'EXPENSE',
            amount: commission,
            currency: 'IQD',
            obligation: false,
            accountId: account.id,
            partyId: party.id,
            categoryType: 'TECH',
            paymentMethod: input.paymentMethod ?? null,
            description: 'Wayl payment commission',
            reference: 'WAYL-COMMISSION',
            createdById: user.id,
          },
        });
      }
      return { partyId: party.id, receivableTotal, payableTotal, amountReceived, commission };
    }, { timeout: 60_000 });
    await audit(user.id, 'PROVIDER_SETTLEMENT', 'Party', summary);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'invalid' };
  }
  revalidatePath('/[locale]/(dashboard)/finance', 'page');
  revalidatePath('/[locale]/(dashboard)/finance/dues', 'page');
  redirect(`/${locale}/finance/dues`);
}
