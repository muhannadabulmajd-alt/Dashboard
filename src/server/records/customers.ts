'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { GOVERNORATES, CUSTOMER_SEGMENTS } from '@/lib/enums';
import { requireCap, audit, reqField, optField, type ActionState } from './shared';

const LIST = '/[locale]/(dashboard)/admin/records/customers';
const CAP = 'manage:customers' as const;

const schema = z.object({
  externalId: z.string().min(1),
  nameEn: z.string().optional(),
  nameAr: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  governorate: z.enum(GOVERNORATES).optional(),
  segment: z.enum(CUSTOMER_SEGMENTS),
  campaignSource: z.string().optional(),
});

function parse(fd: FormData) {
  return schema.safeParse({
    externalId: reqField(fd, 'externalId'),
    nameEn: optField(fd, 'nameEn'),
    nameAr: optField(fd, 'nameAr'),
    phone: optField(fd, 'phone'),
    email: optField(fd, 'email'),
    governorate: optField(fd, 'governorate'),
    segment: reqField(fd, 'segment'),
    campaignSource: optField(fd, 'campaignSource'),
  });
}

export async function createCustomer(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  if (await prisma.customer.findUnique({ where: { externalId: r.data.externalId }, select: { id: true } }))
    return { error: 'exists' };
  const c = await prisma.customer.create({ data: r.data });
  await audit(user.id, 'CREATE', 'Customer', { externalId: r.data.externalId });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/customers/${c.id}`);
}

export async function updateCustomer(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  const dup = await prisma.customer.findUnique({ where: { externalId: r.data.externalId }, select: { id: true } });
  if (dup && dup.id !== id) return { error: 'exists' };
  await prisma.customer.update({ where: { id }, data: r.data });
  await audit(user.id, 'UPDATE', 'Customer', { id, externalId: r.data.externalId });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/customers/${id}`);
}

export async function archiveCustomer(id: string, locale: string, active: boolean): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  await prisma.customer.update({ where: { id }, data: { isActive: active } });
  await audit(user.id, active ? 'RESTORE' : 'ARCHIVE', 'Customer', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/customers/${id}`);
}

export async function deleteCustomer(id: string, locale: string): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  try {
    await prisma.customer.delete({ where: { id } });
    await audit(user.id, 'DELETE', 'Customer', { id });
  } catch {
    // Referenced by orders — archive instead of hard delete.
    await prisma.customer.update({ where: { id }, data: { isActive: false } });
    await audit(user.id, 'ARCHIVE', 'Customer', { id, reason: 'in-use' });
  }
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/customers`);
}
