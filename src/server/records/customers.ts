'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { CUSTOMER_SEGMENTS } from '@/lib/enums';
import { normalizeIraqiPhone } from '@/lib/phone';
import { createCustomerCommand, customerDisplayLabel } from '@/server/commands/customers';
import { requireCap, audit, reqField, optField, type ActionState } from './shared';

const LIST = '/[locale]/(dashboard)/admin/records/customers';
const CAP = 'manage:customers' as const;

const schema = z.object({
  externalId: z.string().optional(), // auto-generated on create, immutable after (CR-4)
  nameEn: z.string().optional(),
  nameAr: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  governorate: z.string().optional(), // list-managed code (§9)
  address1: z.string().optional(),
  street: z.string().optional(),
  notes: z.string().optional(),
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
    address1: optField(fd, 'address1'),
    street: optField(fd, 'street'),
    notes: optField(fd, 'notes'),
    segment: reqField(fd, 'segment'),
    campaignSource: optField(fd, 'campaignSource'),
  });
}

export type InlineCustomerState =
  | { ok: true; customer: { externalId: string; label: string } }
  | { error: string }
  | undefined;

export async function createCustomer(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  const { externalId, ...rest } = r.data;
  void externalId;
  const created = await createCustomerCommand(rest, { actorId: user.id, source: 'customer-form' });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/customers/${created.id}`);
}

export async function createCustomerInline(_prev: InlineCustomerState, fd: FormData): Promise<InlineCustomerState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const { externalId, ...rest } = r.data;
  void externalId;
  const created = await createCustomerCommand(rest, { actorId: user.id, source: 'order-inline-modal' });
  revalidatePath(LIST, 'page');
  return { ok: true, customer: { externalId: created.externalId!, label: customerDisplayLabel(created) } };
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
  const { externalId, ...data } = r.data;
  void externalId;
  await prisma.customer.update({
    where: { id },
    data: { ...data, normalizedPhone: normalizeIraqiPhone(data.phone) },
  });
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
