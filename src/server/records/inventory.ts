'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { INVENTORY_CATEGORIES } from '@/lib/enums';
import { requireCap, audit, reqField, optField, type ActionState } from './shared';

const LIST = '/[locale]/(dashboard)/admin/records/inventory';
const CAP = 'manage:inventory' as const;

const schema = z.object({
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  category: z.enum(INVENTORY_CATEGORIES),
  unit: z.string().min(1),
  productId: z.string().optional(), // linked variation: sales deduct this item (§18)
  reorderPoint: z.coerce.number().int().nonnegative().optional(),
  avgDailyUsage: z.coerce.number().nonnegative().optional(),
  unitCost: z.coerce.number().int().nonnegative().optional(),
});

function parse(fd: FormData) {
  return schema.safeParse({
    nameEn: reqField(fd, 'nameEn'),
    nameAr: reqField(fd, 'nameAr'),
    category: reqField(fd, 'category'),
    unit: reqField(fd, 'unit'),
    productId: optField(fd, 'productId'),
    reorderPoint: optField(fd, 'reorderPoint'),
    avgDailyUsage: optField(fd, 'avgDailyUsage'),
    unitCost: optField(fd, 'unitCost'),
  });
}

// Blank linked-product selection → null (unlinked / raw material).
const withProduct = <T extends { productId?: string }>(data: T) => ({ ...data, productId: data.productId || null });

export async function createInventory(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  const item = await prisma.inventoryItem.create({ data: withProduct(r.data) });
  await audit(user.id, 'CREATE', 'InventoryItem', { id: item.id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/inventory/${item.id}`);
}

export async function updateInventory(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  await prisma.inventoryItem.update({ where: { id }, data: withProduct(r.data) });
  await audit(user.id, 'UPDATE', 'InventoryItem', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/inventory/${id}`);
}

export async function archiveInventory(id: string, locale: string, active: boolean): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  await prisma.inventoryItem.update({ where: { id }, data: { isActive: active } });
  await audit(user.id, active ? 'RESTORE' : 'ARCHIVE', 'InventoryItem', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/inventory/${id}`);
}

export async function deleteInventory(id: string, locale: string): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  try {
    await prisma.inventoryItem.delete({ where: { id } });
    await audit(user.id, 'DELETE', 'InventoryItem', { id });
  } catch {
    // Movements cascade-delete, but keep the archive fallback for any other constraint.
    await prisma.inventoryItem.update({ where: { id }, data: { isActive: false } });
    await audit(user.id, 'ARCHIVE', 'InventoryItem', { id, reason: 'in-use' });
  }
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/inventory`);
}
