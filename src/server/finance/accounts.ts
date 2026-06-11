'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { ACCOUNT_TYPES, CURRENCIES } from '@/lib/enums';
import { requireCap, audit, reqField, optField, type ActionState } from '../records/shared';

const LIST = '/[locale]/(dashboard)/finance/accounts';
const CAP = 'manage:finance' as const;

const schema = z.object({
  name: z.string().min(1),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.enum(CURRENCIES),
  bankName: z.string().optional(),
  branchId: z.string().optional(),
  openingBalance: z.coerce.number().int().default(0),
  notes: z.string().optional(),
});

function parse(fd: FormData) {
  return schema.safeParse({
    name: reqField(fd, 'name'),
    type: reqField(fd, 'type'),
    currency: reqField(fd, 'currency'),
    bankName: optField(fd, 'bankName'),
    branchId: optField(fd, 'branchId'),
    openingBalance: optField(fd, 'openingBalance'),
    notes: optField(fd, 'notes'),
  });
}

export async function createAccount(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  const row = await prisma.financeAccount.create({
    data: { ...r.data, branchId: r.data.branchId ?? null },
  });
  await audit(user.id, 'CREATE', 'FinanceAccount', { id: row.id, name: row.name });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/finance/accounts/${row.id}`);
}

export async function updateAccount(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  await prisma.financeAccount.update({
    where: { id },
    data: { ...r.data, branchId: r.data.branchId ?? null },
  });
  await audit(user.id, 'UPDATE', 'FinanceAccount', { id, name: r.data.name });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/finance/accounts/${id}`);
}

export async function archiveAccount(id: string, locale: string, active: boolean): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  await prisma.financeAccount.update({ where: { id }, data: { isActive: active } });
  await audit(user.id, active ? 'RESTORE' : 'ARCHIVE', 'FinanceAccount', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/finance/accounts/${id}`);
}

export async function deleteAccount(id: string, locale: string): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  try {
    await prisma.financeAccount.delete({ where: { id } });
    await audit(user.id, 'DELETE', 'FinanceAccount', { id });
  } catch {
    // Referenced by finance entries — archive instead of hard delete.
    await prisma.financeAccount.update({ where: { id }, data: { isActive: false } });
    await audit(user.id, 'ARCHIVE', 'FinanceAccount', { id, reason: 'in-use' });
  }
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/finance/accounts`);
}
