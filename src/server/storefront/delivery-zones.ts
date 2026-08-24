'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/server/db/client';
import { audit, optField, reqField, requireCap } from '@/server/records/shared';
import { storefrontDeliveryZoneInputSchema } from './contracts';

const PAGE = '/[locale]/(dashboard)/admin/records/storefront';

function parseZone(fd: FormData) {
  return storefrontDeliveryZoneInputSchema.safeParse({
    code: reqField(fd, 'code'),
    nameEn: reqField(fd, 'nameEn'),
    nameAr: reqField(fd, 'nameAr'),
    governorate: optField(fd, 'governorate'),
    deliveryFee: reqField(fd, 'deliveryFee'),
    minimumOrder: reqField(fd, 'minimumOrder') || '0',
    freeDeliveryAt: optField(fd, 'freeDeliveryAt'),
    sortOrder: reqField(fd, 'sortOrder') || '0',
  });
}

function returnTo(locale: string, result: 'saved' | 'invalid' | 'exists'): never {
  redirect(`/${locale}/admin/records/storefront?result=${result}`);
}

export async function createDeliveryZone(fd: FormData): Promise<void> {
  const user = await requireCap('manage:products');
  if (!user) return;
  const locale = reqField(fd, 'locale') || 'ar';
  const parsed = parseZone(fd);
  if (!parsed.success) returnTo(locale, 'invalid');
  const code = parsed.data.code.toUpperCase();
  const exists = await prisma.storefrontDeliveryZone.findUnique({ where: { code }, select: { id: true } });
  if (exists) returnTo(locale, 'exists');
  const zone = await prisma.storefrontDeliveryZone.create({
    data: {
      ...parsed.data,
      code,
      governorate: parsed.data.governorate || null,
      freeDeliveryAt: parsed.data.freeDeliveryAt ?? null,
    },
  });
  await audit(user.id, 'CREATE', 'StorefrontDeliveryZone', { id: zone.id, code });
  revalidatePath(PAGE, 'page');
  returnTo(locale, 'saved');
}

export async function updateDeliveryZone(id: string, fd: FormData): Promise<void> {
  const user = await requireCap('manage:products');
  if (!user) return;
  const locale = reqField(fd, 'locale') || 'ar';
  const parsed = parseZone(fd);
  if (!parsed.success) returnTo(locale, 'invalid');
  const before = await prisma.storefrontDeliveryZone.findUnique({ where: { id }, select: { code: true } });
  if (!before) returnTo(locale, 'invalid');
  await prisma.storefrontDeliveryZone.update({
    where: { id },
    data: {
      nameEn: parsed.data.nameEn,
      nameAr: parsed.data.nameAr,
      governorate: parsed.data.governorate || null,
      deliveryFee: parsed.data.deliveryFee,
      minimumOrder: parsed.data.minimumOrder,
      freeDeliveryAt: parsed.data.freeDeliveryAt ?? null,
      sortOrder: parsed.data.sortOrder,
    },
  });
  await audit(user.id, 'UPDATE', 'StorefrontDeliveryZone', { id, code: before.code });
  revalidatePath(PAGE, 'page');
  returnTo(locale, 'saved');
}

export async function setDeliveryZoneActive(id: string, active: boolean, locale: string, _fd: FormData): Promise<void> {
  void _fd;
  const user = await requireCap('manage:products');
  if (!user) return;
  await prisma.storefrontDeliveryZone.update({ where: { id }, data: { isActive: active } });
  await audit(user.id, active ? 'RESTORE' : 'ARCHIVE', 'StorefrontDeliveryZone', { id });
  revalidatePath(PAGE, 'page');
  redirect(`/${locale}/admin/records/storefront?result=saved`);
}
