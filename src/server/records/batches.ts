'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/client';
import { decimalNumber } from '@/lib/decimal';
import { syncActiveCost } from '@/server/inventory/fifo';
import type { TrustedCommandContext } from '@/server/commands/actor-context';
import { COMMAND_TRANSACTION_OPTIONS } from '@/server/commands/transaction-checkpoints';
import {
  requireCap,
  audit,
  reqField,
  optField,
  resolveCommandActor,
  type ActionState,
  type CommandCommitHook,
  type CommandPreconditionHook,
} from './shared';

const LIST = '/[locale]/(dashboard)/admin/records/batches';
const CAP = 'manage:batches' as const;

const schema = z.object({
  batchNumber: z.string().min(1),
  origin: z.string().min(1),
  roastDate: z.coerce.date().optional(),
  roastLevel: z.string().optional(), // list-managed code (§9)
  greenInputGrams: z.coerce.number().int().positive(),
  roastedOutputGrams: z.coerce.number().int().positive().optional(),
  qcScore: z.coerce.number().optional(),
  qcNotes: z.string().optional(),
});

const RoastBatchCommandSchema = schema.extend({
  greenInventoryItemId: z.string().min(1).nullish(),
  roastedInventoryItemId: z.string().min(1).nullish(),
  branchId: z.string().min(1).nullish(),
}).strict().superRefine((value, ctx) => {
  if (Boolean(value.greenInventoryItemId) !== Boolean(value.roastedInventoryItemId)) {
    ctx.addIssue({
      code: 'custom',
      path: ['greenInventoryItemId'],
      message: 'Both green and roasted inventory items are required.',
    });
  }
  if (value.greenInventoryItemId && !value.roastedOutputGrams) {
    ctx.addIssue({
      code: 'custom',
      path: ['roastedOutputGrams'],
      message: 'Roasted output is required for inventory synchronization.',
    });
  }
  if (value.roastedOutputGrams && value.roastedOutputGrams > value.greenInputGrams) {
    ctx.addIssue({
      code: 'custom',
      path: ['roastedOutputGrams'],
      message: 'Roasted output cannot exceed green input.',
    });
  }
});

export type RoastBatchCommandInput = z.input<typeof RoastBatchCommandSchema>;

function gramsInInventoryUnit(grams: number, unit: string): number {
  const normalized = unit.trim().toLowerCase();
  if (normalized === 'kg') return Number((grams / 1_000).toFixed(3));
  if (normalized === 'g' || normalized === 'gram') return Number(grams.toFixed(3));
  throw new Error('batch_inventory_unit');
}

export async function createRoastBatchFromInput(
  rawInput: RoastBatchCommandInput,
  options: {
    actorContext?: TrustedCommandContext;
    precondition?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<{
      recordId: string;
      batchNumber: string;
      greenQuantity: number | null;
      roastedQuantity: number | null;
    }>;
  } = {},
) {
  const user = await resolveCommandActor(CAP, options.actorContext);
  if (!user) throw new Error('forbidden');
  const input = RoastBatchCommandSchema.parse(rawInput);

  return prisma.$transaction(async (tx) => {
    await options.precondition?.(tx);
    const existing = await tx.roastBatch.findUnique({
      where: { batchNumber: input.batchNumber },
      select: { id: true },
    });
    if (existing) throw new Error('batch_exists');

    const green = input.greenInventoryItemId
      ? await tx.inventoryItem.findFirst({
          where: { id: input.greenInventoryItemId, isActive: true },
        })
      : null;
    const roasted = input.roastedInventoryItemId
      ? await tx.inventoryItem.findFirst({
          where: { id: input.roastedInventoryItemId, isActive: true },
        })
      : null;
    if (input.greenInventoryItemId && (!green || green.category !== 'GREEN_COFFEE')) {
      throw new Error('green_inventory');
    }
    if (input.roastedInventoryItemId && (!roasted || roasted.category !== 'ROASTED')) {
      throw new Error('roasted_inventory');
    }

    const greenQuantity = green
      ? gramsInInventoryUnit(input.greenInputGrams, green.unit)
      : null;
    const roastedQuantity = roasted && input.roastedOutputGrams
      ? gramsInInventoryUnit(input.roastedOutputGrams, roasted.unit)
      : null;
    if (green && greenQuantity != null) {
      const available = await tx.stockMovement.aggregate({
        where: { inventoryItemId: green.id },
        _sum: { quantity: true },
      });
      if (decimalNumber(available._sum.quantity) + 0.0005 < greenQuantity) {
        throw new Error('stock_insufficient');
      }
    }

    const batch = await tx.roastBatch.create({
      data: {
        batchNumber: input.batchNumber,
        origin: input.origin,
        roastDate: input.roastDate ?? null,
        roastLevel: input.roastLevel ?? null,
        greenInputGrams: input.greenInputGrams,
        roastedOutputGrams: input.roastedOutputGrams ?? null,
        qcScore: input.qcScore ?? null,
        qcNotes: input.qcNotes ?? null,
        operatorId: user.id,
        branchId: input.branchId ?? green?.branchId ?? roasted?.branchId ?? null,
        greenInventoryItemId: green?.id ?? null,
        roastedInventoryItemId: roasted?.id ?? null,
      },
    });
    if (green && roasted && greenQuantity != null && roastedQuantity != null) {
      const occurredAt = input.roastDate ?? new Date();
      const roastedUnitCost = roastedQuantity > 0
        ? greenQuantity * decimalNumber(green.unitCost) / roastedQuantity
        : 0;
      await tx.stockMovement.createMany({
        data: [
          {
            inventoryItemId: green.id,
            roastBatchId: batch.id,
            occurredAt,
            reason: 'PRODUCTION_OUT',
            quantity: new Prisma.Decimal(-greenQuantity),
            reference: input.batchNumber,
            externalId: `BATCH:${input.batchNumber}:GREEN`,
            branchId: batch.branchId,
          },
          {
            inventoryItemId: roasted.id,
            roastBatchId: batch.id,
            occurredAt,
            reason: 'PRODUCTION_IN',
            quantity: new Prisma.Decimal(roastedQuantity),
            reference: input.batchNumber,
            externalId: `BATCH:${input.batchNumber}:ROASTED`,
            branchId: batch.branchId,
          },
        ],
      });
      await tx.inventoryCostLayer.create({
        data: {
          inventoryItemId: roasted.id,
          roastBatchId: batch.id,
          qtyReceived: new Prisma.Decimal(roastedQuantity),
          unitCost: new Prisma.Decimal(roastedUnitCost.toFixed(3)),
          receivedAt: occurredAt,
        },
      });
      await syncActiveCost(green.id, tx);
      await syncActiveCost(roasted.id, tx);
    }
    const result = {
      recordId: batch.id,
      batchNumber: batch.batchNumber,
      greenQuantity,
      roastedQuantity,
    };
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'CREATE',
        entity: 'RoastBatch',
        entityId: batch.id,
        metadata: {
          batchNumber: batch.batchNumber,
          greenInventoryItemId: green?.id ?? null,
          roastedInventoryItemId: roasted?.id ?? null,
          greenInputGrams: input.greenInputGrams,
          roastedOutputGrams: input.roastedOutputGrams ?? null,
          source: options.actorContext ? 'trusted-command' : 'form',
        },
      },
    });
    await options.onCommitted?.(tx, result);
    return result;
  }, COMMAND_TRANSACTION_OPTIONS);
}

function parse(fd: FormData) {
  return schema.safeParse({
    batchNumber: reqField(fd, 'batchNumber'),
    origin: reqField(fd, 'origin'),
    roastDate: optField(fd, 'roastDate'),
    roastLevel: optField(fd, 'roastLevel'),
    greenInputGrams: reqField(fd, 'greenInputGrams'),
    roastedOutputGrams: optField(fd, 'roastedOutputGrams'),
    qcScore: optField(fd, 'qcScore'),
    qcNotes: optField(fd, 'qcNotes'),
  });
}

export async function createBatch(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  let batchId = '';
  try {
    const batch = await createRoastBatchFromInput(r.data);
    batchId = batch.recordId;
  } catch (error) {
    return { error: error instanceof Error && error.message === 'batch_exists' ? 'exists' : 'invalid' };
  }
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/batches/${batchId}`);
}

export async function updateBatch(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  // Batch number is the permanent key — immutable after creation (CR-5).
  const { batchNumber, ...data } = r.data;
  void batchNumber;
  await prisma.roastBatch.update({ where: { id }, data });
  await audit(user.id, 'UPDATE', 'RoastBatch', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/batches/${id}`);
}

export async function archiveBatch(id: string, locale: string, active: boolean): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  await prisma.roastBatch.update({ where: { id }, data: { isActive: active } });
  await audit(user.id, active ? 'RESTORE' : 'ARCHIVE', 'RoastBatch', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/batches/${id}`);
}

export async function deleteBatch(id: string, locale: string): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  try {
    await prisma.roastBatch.delete({ where: { id } });
    await audit(user.id, 'DELETE', 'RoastBatch', { id });
  } catch {
    // Referenced by SKU links — archive instead of hard delete.
    await prisma.roastBatch.update({ where: { id }, data: { isActive: false } });
    await audit(user.id, 'ARCHIVE', 'RoastBatch', { id, reason: 'in-use' });
  }
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/batches`);
}
