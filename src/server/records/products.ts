'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { PRODUCT_LINES, GRINDS, ROAST_LEVELS } from '@/lib/enums';
import { requireCap, audit, reqField, optField, type ActionState } from './shared';

const LIST = '/[locale]/(dashboard)/admin/records/products';
const CAP = 'manage:products' as const;

const schema = z.object({
  sku: z.string().min(3),
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  productLine: z.enum(PRODUCT_LINES),
  sizeLabel: z.string().min(1),
  sizeGrams: z.coerce.number().int().positive().optional(),
  grind: z.enum(GRINDS),
  roastLevel: z.enum(ROAST_LEVELS).optional(),
  origin: z.string().optional(),
  sellingPrice: z.coerce.number().int().nonnegative(),
  cogsPerUnit: z.coerce.number().int().nonnegative(),
});

function parse(fd: FormData) {
  return schema.safeParse({
    sku: reqField(fd, 'sku'),
    nameEn: reqField(fd, 'nameEn'),
    nameAr: reqField(fd, 'nameAr'),
    productLine: reqField(fd, 'productLine'),
    sizeLabel: reqField(fd, 'sizeLabel'),
    sizeGrams: optField(fd, 'sizeGrams'),
    grind: reqField(fd, 'grind'),
    roastLevel: optField(fd, 'roastLevel'),
    origin: optField(fd, 'origin'),
    sellingPrice: reqField(fd, 'sellingPrice'),
    cogsPerUnit: reqField(fd, 'cogsPerUnit'),
  });
}

export async function createProduct(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  if (await prisma.product.findUnique({ where: { sku: r.data.sku }, select: { id: true } }))
    return { error: 'exists' };
  const p = await prisma.product.create({ data: r.data });
  await audit(user.id, 'CREATE', 'Product', { sku: r.data.sku });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/products/${p.id}`);
}

export async function updateProduct(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  // SKU is the permanent key — immutable after creation (CR-5).
  const { sku: _immutable, ...data } = r.data;
  await prisma.product.update({ where: { id }, data });
  await audit(user.id, 'UPDATE', 'Product', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/products/${id}`);
}

export async function archiveProduct(id: string, locale: string, active: boolean): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  await prisma.product.update({ where: { id }, data: { isActive: active } });
  await audit(user.id, active ? 'RESTORE' : 'ARCHIVE', 'Product', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/products/${id}`);
}

export async function deleteProduct(id: string, locale: string): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  try {
    await prisma.product.delete({ where: { id } });
    await audit(user.id, 'DELETE', 'Product', { id });
  } catch {
    // Referenced by orders/batches/inventory — archive instead of hard delete.
    await prisma.product.update({ where: { id }, data: { isActive: false } });
    await audit(user.id, 'ARCHIVE', 'Product', { id, reason: 'in-use' });
  }
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/products`);
}
