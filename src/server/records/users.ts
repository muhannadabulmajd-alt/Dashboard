'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { ROLES } from '@/lib/enums';
import { requireCap, audit, reqField, optField, type ActionState } from './shared';

const LIST = '/[locale]/(dashboard)/admin/users';
const CAP = 'manage:users' as const;

const schema = z.object({
  name: z.string().min(2),
  role: z.enum(ROLES),
  branchId: z.string().optional(),
  defaultFinanceAccountId: z.string().optional(),
});

async function activeOwnerCount(): Promise<number> {
  return prisma.user.count({ where: { role: 'OWNER', isActive: true } });
}

export async function updateUser(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireCap(CAP);
  if (!actor) return { error: 'forbidden' };
  const r = schema.safeParse({
    name: reqField(fd, 'name'),
    role: reqField(fd, 'role'),
    branchId: optField(fd, 'branchId'),
    defaultFinanceAccountId: optField(fd, 'defaultFinanceAccountId'),
  });
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';

  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!target) return { error: 'notfound' };
  // You can't change your own role (avoids self-lockout).
  if (id === actor.id && r.data.role !== target.role) return { error: 'self' };
  // Keep at least one active Owner.
  if (target.role === 'OWNER' && r.data.role !== 'OWNER' && (await activeOwnerCount()) <= 1)
    return { error: 'lastOwner' };

  if (r.data.defaultFinanceAccountId) {
    const account = await prisma.financeAccount.findFirst({
      where: { id: r.data.defaultFinanceAccountId, isActive: true, currency: 'IQD', type: { not: 'PAYMENT_GATEWAY' } },
      select: { id: true },
    });
    if (!account) return { error: 'invalid' };
  }
  await prisma.user.update({
    where: { id },
    data: {
      name: r.data.name,
      role: r.data.role,
      branchId: r.data.branchId ?? null,
      defaultFinanceAccountId: r.data.defaultFinanceAccountId ?? null,
    },
  });
  await audit(actor.id, 'UPDATE_USER', 'User', { id, role: r.data.role });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/users`);
}

export async function setUserActive(id: string, locale: string, active: boolean): Promise<void> {
  const actor = await requireCap(CAP);
  if (!actor) return;
  // Never deactivate yourself or the last active Owner.
  if (!active) {
    if (id === actor.id) redirect(`/${locale}/admin/users`);
    const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
    if (target?.role === 'OWNER' && (await activeOwnerCount()) <= 1) redirect(`/${locale}/admin/users`);
  }
  await prisma.user.update({ where: { id }, data: { isActive: active } });
  await audit(actor.id, active ? 'ACTIVATE_USER' : 'DEACTIVATE_USER', 'User', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/users`);
}
