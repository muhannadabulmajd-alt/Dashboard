'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { INVENTORY_CATEGORIES } from '@/lib/enums';
import { decimalNumber } from '@/lib/decimal';
import { syncActiveCost, recomputeProductsForItem } from '@/server/inventory/fifo';
import { syncInventoryReceiptFinance } from '@/server/finance/sync';
import type { TrustedCommandContext } from '@/server/commands/actor-context';
import {
  requireCap,
  resolveCommandActor,
  audit,
  reqField,
  optField,
  type ActionState,
  type CommandCommitHook,
  type CommandPreconditionHook,
} from './shared';

const LIST = '/[locale]/(dashboard)/admin/records/inventory';
const FINANCE = '/[locale]/(dashboard)/finance';
const LEDGER = '/[locale]/(dashboard)/finance/ledger';
const DUES = '/[locale]/(dashboard)/finance/dues';
const CAP = 'manage:inventory' as const;
const decimal3 = z.coerce.number().nonnegative().refine((v) => Number.isInteger(v * 1000));
const positiveDecimal3 = z.coerce.number().positive().refine((v) => Number.isInteger(v * 1000));
const adjustmentSchema = z.object({
  targetQuantity: decimal3,
  occurredAt: z.coerce.date(),
  reason: z.string().min(3),
});

const InventoryAdjustmentCommandSchema = z.object({
  inventoryItemId: z.string().min(1),
  targetQuantity: decimal3,
  occurredAt: z.coerce.date(),
  reason: z.string().trim().min(3),
});

export type InventoryAdjustmentCommandInput = z.input<typeof InventoryAdjustmentCommandSchema>;

export async function adjustInventoryFromInput(
  input: InventoryAdjustmentCommandInput,
  options: {
    actorContext?: TrustedCommandContext;
    precondition?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<{
      recordId: string;
      beforeQuantity: number;
      targetQuantity: number;
      adjustment: number;
    }>;
  } = {},
) {
  const user = await resolveCommandActor(CAP, options.actorContext);
  if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) {
    throw new Error('forbidden');
  }
  const parsed = InventoryAdjustmentCommandSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    await options.precondition?.(tx);
    const item = await tx.inventoryItem.findUnique({
      where: { id: parsed.inventoryItemId },
      include: { movements: { select: { quantity: true } } },
    });
    if (!item || !item.isActive) throw new Error('inventory-not-found');
    const current = item.movements.reduce(
      (sum, movement) => sum + decimalNumber(movement.quantity),
      0,
    );
    const delta = Number((parsed.targetQuantity - current).toFixed(3));

    if (delta !== 0) {
      await tx.stockMovement.create({
        data: {
          inventoryItemId: item.id,
          occurredAt: parsed.occurredAt,
          reason: 'ADJUSTMENT',
          quantity: delta.toFixed(3),
          reference: `Owner/Admin stock correction: ${parsed.reason}`,
          branchId: item.branchId,
        },
      });
      if (delta > 0) {
        await tx.inventoryCostLayer.create({
          data: {
            inventoryItemId: item.id,
            qtyReceived: delta.toFixed(3),
            unitCost: (item.unitCost ?? 0).toString(),
            receivedAt: parsed.occurredAt,
          },
        });
      }
      await syncActiveCost(item.id, tx);
    }

    const result = {
      recordId: item.id,
      beforeQuantity: current,
      targetQuantity: parsed.targetQuantity,
      adjustment: delta,
    };
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'ADJUST_QUANTITY',
        entity: 'InventoryItem',
        entityId: item.id,
        metadata: {
          reason: parsed.reason,
          beforeQuantity: current.toFixed(3),
          targetQuantity: parsed.targetQuantity.toFixed(3),
          adjustment: delta.toFixed(3),
          occurredAt: parsed.occurredAt.toISOString(),
        },
      },
    });
    await options.onCommitted?.(tx, result);
    return result;
  });
}

const schema = z.object({
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  category: z.enum(INVENTORY_CATEGORIES),
  unit: z.string().min(1),
  productId: z.string().optional(), // linked variation: sales deduct this item (§18)
  branchId: z.string().optional(),
  reorderPoint: decimal3.optional(),
  avgDailyUsage: z.coerce.number().nonnegative().optional(),
  unitCost: decimal3.optional(),
});

function parse(fd: FormData) {
  return schema.safeParse({
    nameEn: reqField(fd, 'nameEn'),
    nameAr: reqField(fd, 'nameAr'),
    category: reqField(fd, 'category'),
    unit: reqField(fd, 'unit'),
    productId: optField(fd, 'productId'),
    branchId: optField(fd, 'branchId'),
    reorderPoint: optField(fd, 'reorderPoint'),
    avgDailyUsage: optField(fd, 'avgDailyUsage'),
    unitCost: optField(fd, 'unitCost'),
  });
}

// Blank linked-product selection → null (unlinked / raw material).
const withRelations = <T extends { productId?: string; branchId?: string }>(data: T) => ({
  ...data,
  productId: data.productId || null,
  branchId: data.branchId || null,
});

export async function createInventory(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  const item = await prisma.inventoryItem.create({ data: withRelations(r.data) });
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
  await prisma.inventoryItem.update({ where: { id }, data: withRelations(r.data) });
  await audit(user.id, 'UPDATE', 'InventoryItem', { id });
  // Dynamic recalculation (§4.3): a changed component cost recomputes the cost
  // of every product whose recipe links this item.
  if (r.data.unitCost != null && before && r.data.unitCost !== decimalNumber(before.unitCost)) {
    await recomputeProductsForItem(id, r.data.unitCost);
  }
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/inventory/${id}`);
}

export async function setInventoryQuantity(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const parsed = adjustmentSchema.safeParse({
    targetQuantity: reqField(fd, 'targetQuantity'),
    occurredAt: reqField(fd, 'occurredAt'),
    reason: reqField(fd, 'adjustmentReason'),
  });
  if (!parsed.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  try {
    await adjustInventoryFromInput({ inventoryItemId: id, ...parsed.data });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'invalid' };
  }
  revalidatePath(LIST, 'page');
  revalidatePath(FINANCE, 'page');
  revalidatePath(LEDGER, 'page');
  revalidatePath('/[locale]/(dashboard)', 'page');
  redirect(`/${locale}/admin/records/inventory/${id}`);
}

const receiveSchema = z.object({
  qtyReceived: positiveDecimal3,
  unitCost: decimal3,
  receivedAt: z.coerce.date(),
  expiryDate: z.coerce.date().optional(),
  reference: z.string().optional(),
  paymentMode: z.enum(['CREDIT', 'PAID']).default('CREDIT'),
  accountId: z.string().optional(),
  partyId: z.string().optional(),
  dueDate: z.coerce.date().optional(),
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
    paymentMode: optField(fd, 'paymentMode') || 'CREDIT',
    accountId: optField(fd, 'accountId'),
    partyId: optField(fd, 'partyId'),
    dueDate: optField(fd, 'dueDate'),
  });
  if (!r.success) return { error: 'invalid' };
  if (r.data.paymentMode === 'PAID' && !r.data.accountId) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  await prisma.$transaction(async (tx) => {
    const layer = await tx.inventoryCostLayer.create({
      data: {
        inventoryItemId: itemId,
        qtyReceived: r.data.qtyReceived,
        unitCost: r.data.unitCost,
        receivedAt: r.data.receivedAt,
      },
    });
    const movement = await tx.stockMovement.create({
      data: {
        inventoryItemId: itemId,
        occurredAt: r.data.receivedAt,
        reason: 'PURCHASE',
        quantity: r.data.qtyReceived,
        expiryDate: r.data.expiryDate ?? null,
        reference: r.data.reference ?? null,
      },
    });
    const financeEntryId = await syncInventoryReceiptFinance(tx, {
      movementId: movement.id,
      inventoryItemId: itemId,
      quantity: r.data.qtyReceived,
      unitCost: r.data.unitCost,
      receivedAt: r.data.receivedAt,
      paymentMode: r.data.paymentMode,
      accountId: r.data.accountId,
      partyId: r.data.partyId,
      dueDate: r.data.dueDate,
      reference: r.data.reference,
      createdById: user.id,
    });
    if (financeEntryId) {
      await tx.inventoryCostLayer.update({ where: { id: layer.id }, data: { financeEntryId } });
      await tx.stockMovement.update({ where: { id: movement.id }, data: { financeEntryId } });
    }
  });
  await syncActiveCost(itemId);
  await audit(user.id, 'RECEIVE', 'InventoryItem', { id: itemId, qty: r.data.qtyReceived, unitCost: r.data.unitCost });
  revalidatePath(LIST, 'page');
  revalidatePath(FINANCE, 'page');
  revalidatePath(LEDGER, 'page');
  revalidatePath(DUES, 'page');
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
