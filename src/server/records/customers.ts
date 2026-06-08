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
  externalId: z.string().optional(), // auto-generated on create, immutable after (CR-4)
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
    externalId: optField(fd, 'externalId'),
    nameEn: optField(fd, 'nameEn'),
    nameAr: optField(fd, 'nameAr'),
    phone: optField(fd, 'phone'),
    email: optField(fd, 'email'),
    governorate: optField(fd, 'governorate'),
    segment: reqField(fd, 'segment'),
    campaignSource: optField(fd, 'campaignSource'),
  });
}

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2002';

/** Next sequential customer code, e.g. CL-000001. Spans legacy CL-1 and padded forms. */
async function nextCustomerCode(): Promise<string> {
  const rows = await prisma.customer.findMany({ select: { externalId: true } });
  let max = 0;
  for (const { externalId } of rows) {
    const m = externalId?.match(/^CL-0*(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `CL-${String(max + 1).padStart(6, '0')}`;
}

export async function createCustomer(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  // Customer ID is auto-generated (CR-4). A manually supplied value is honored
  // but must be unique; otherwise we generate the next code, retrying on races.
  const provided = r.data.externalId?.trim();
  if (provided && (await prisma.customer.findUnique({ where: { externalId: provided }, select: { id: true } })))
    return { error: 'exists' };
  const { externalId: _omit, ...rest } = r.data;
  let created;
  for (let attempt = 0; ; attempt++) {
    const externalId = provided || (await nextCustomerCode());
    try {
      created = await prisma.customer.create({ data: { ...rest, externalId } });
      break;
    } catch (e) {
      if (!provided && isUniqueViolation(e) && attempt < 5) continue;
      throw e;
    }
  }
  await audit(user.id, 'CREATE', 'Customer', { externalId: created.externalId });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/customers/${created.id}`);
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
  // externalId is immutable after creation (CR-4) — never update it.
  const { externalId: _immutable, ...data } = r.data;
  await prisma.customer.update({ where: { id }, data });
  await audit(user.id, 'UPDATE', 'Customer', { id });
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
