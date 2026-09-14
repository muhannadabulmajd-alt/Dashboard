import 'server-only';

import type { Prisma } from '@prisma/client';
import { decimalNumber } from '@/lib/decimal';

type Tx = Prisma.TransactionClient;

export type RecipeSnapshotRow = {
  inventoryItemId?: string | null;
  name: string;
  quantity: number | Prisma.Decimal;
  unitCost: number | Prisma.Decimal;
  isRequired?: boolean;
};

export function recipeSnapshotSignature(rows: RecipeSnapshotRow[]): string {
  return JSON.stringify(rows.map((row) => ({
    inventoryItemId: row.inventoryItemId ?? null,
    name: row.name.trim(),
    quantity: decimalNumber(row.quantity).toFixed(3),
    unitCost: decimalNumber(row.unitCost).toFixed(3),
    isRequired: row.isRequired ?? true,
  })).sort((left, right) => (
    `${left.inventoryItemId ?? ''}:${left.name}:${left.quantity}:${left.unitCost}`
      .localeCompare(`${right.inventoryItemId ?? ''}:${right.name}:${right.quantity}:${right.unitCost}`)
  )));
}

export async function activateProductRecipeVersion(
  tx: Tx,
  input: {
    productId: string;
    actorId: string;
    components: RecipeSnapshotRow[];
    effectiveFrom?: Date;
    notes?: string;
  },
) {
  if (!input.components.length) throw new Error('recipe_empty');
  const active = await tx.productRecipeVersion.findFirst({
    where: { productId: input.productId, isActive: true },
    include: { components: true },
    orderBy: { version: 'desc' },
  });
  if (active && recipeSnapshotSignature(active.components) === recipeSnapshotSignature(input.components)) {
    return { recipe: active, created: false };
  }
  const latest = await tx.productRecipeVersion.aggregate({
    where: { productId: input.productId },
    _max: { version: true },
  });
  await tx.productRecipeVersion.updateMany({
    where: { productId: input.productId, isActive: true },
    data: { isActive: false },
  });
  const recipe = await tx.productRecipeVersion.create({
    data: {
      productId: input.productId,
      version: (latest._max.version ?? 0) + 1,
      effectiveFrom: input.effectiveFrom ?? new Date(),
      isActive: true,
      notes: input.notes,
      createdById: input.actorId,
      components: {
        create: input.components.map((row) => ({
          inventoryItemId: row.inventoryItemId ?? null,
          name: row.name.trim(),
          quantity: decimalNumber(row.quantity).toFixed(3),
          unitCost: decimalNumber(row.unitCost).toFixed(3),
          isRequired: row.isRequired ?? true,
        })),
      },
    },
    include: { components: true },
  });
  return { recipe, created: true };
}
