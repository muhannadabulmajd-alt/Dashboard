'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { PARTY_TYPES } from '@/lib/enums';
import { requireCap, audit, reqField, optField, type ActionState } from '../records/shared';

const LIST = '/[locale]/(dashboard)/finance/parties';
const CAP = 'manage:finance' as const;

const schema = z.object({
  name: z.string().min(1),
  type: z.enum(PARTY_TYPES),
  phone: z.string().optional(),
  email: z.string().optional(),
  notes: z.string().optional(),
  equityShare: z.coerce.number().optional(),
});

function parse(fd: FormData) {
  return schema.safeParse({
    name: reqField(fd, 'name'),
    type: reqField(fd, 'type'),
    phone: optField(fd, 'phone'),
    email: optField(fd, 'email'),
    notes: optField(fd, 'notes'),
    equityShare: optField(fd, 'equityShare'),
  });
}

export async function createParty(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  const row = await prisma.party.create({ data: r.data });
  await audit(user.id, 'CREATE', 'Party', { id: row.id, name: row.name });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/finance/parties/${row.id}`);
}

export async function updateParty(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  await prisma.party.update({ where: { id }, data: r.data });
  await audit(user.id, 'UPDATE', 'Party', { id, name: r.data.name });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/finance/parties/${id}`);
}

export async function archiveParty(id: string, locale: string, active: boolean): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  await prisma.party.update({ where: { id }, data: { isActive: active } });
  await audit(user.id, active ? 'RESTORE' : 'ARCHIVE', 'Party', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/finance/parties/${id}`);
}

export async function deleteParty(id: string, locale: string): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  try {
    await prisma.party.delete({ where: { id } });
    await audit(user.id, 'DELETE', 'Party', { id });
  } catch {
    // Referenced by finance entries — archive instead of hard delete.
    await prisma.party.update({ where: { id }, data: { isActive: false } });
    await audit(user.id, 'ARCHIVE', 'Party', { id, reason: 'in-use' });
  }
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/finance/parties`);
}
