'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { INVENTORY_CATEGORIES } from '@/lib/enums';
import { syncActiveCost, recomputeProductsForItem } from '@/server/inventory/fifo';
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
  const before = await prisma.inventoryItem.findUnique({ where: { id }, select: { unitCost: true } });
  await prisma.inventoryItem.update({ where: { id }, data: withProduct(r.data) });
  await audit(user.id, 'UPDATE', 'InventoryItem', { id });
  // Dynamic recalculation (§4.3): a changed component cost recomputes the cost
  // of every product whose recipe links this item.
  if (r.data.unitCost != null && before && r.data.unitCost !== before.unitCost) {
    await recomputeProductsForItem(id, r.data.unitCost);
  }
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/inventory/${id}`);
}

const receiveSchema = z.object({
  qtyReceived: z.coerce.number().int().positive(),
  unitCost: z.coerce.number().int().nonnegative(),
  receivedAt: z.coerce.date(),
  expiryDate: z.coerce.date().optional(),
  reference: z.string().optional(),
});

/**
 * Receive stock at a cost (§8): records an immutable FIFO cost layer plus a
 * PURCHASE movement (so on-hand stock and the layer stay in lock-step), then
 * re-derives the item's active FIFO cost. The active cost rolls to this layer
 * once older layers are consumed.
 */
export async function receiveStock(itemId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = receiveSchema.safeParse({
    qtyReceived: reqField(fd, 'qtyReceived'),
    unitCost: reqField(fd, 'unitCost'),
    receivedAt: reqField(fd, 'receivedAt'),
    expiryDate: optField(fd, 'expiryDate'),
    reference: optField(fd, 'reference'),
  });
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  await prisma.$transaction(async (tx) => {
    await tx.inventoryCostLayer.create({
      data: {
        inventoryItemId: itemId,
        qtyReceived: r.data.qtyReceived,
        unitCost: r.data.unitCost,
        receivedAt: r.data.receivedAt,
      },
    });
    await tx.stockMovement.create({
      data: {
        inventoryItemId: itemId,
        occurredAt: r.data.receivedAt,
        reason: 'PURCHASE',
        quantity: r.data.qtyReceived,
        expiryDate: r.data.expiryDate ?? null,
        reference: r.data.reference ?? null,
      },
    });
  });
  await syncActiveCost(itemId);
  await audit(user.id, 'RECEIVE', 'InventoryItem', { id: itemId, qty: r.data.qtyReceived, unitCost: r.data.unitCost });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/inventory/${itemId}`);
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
