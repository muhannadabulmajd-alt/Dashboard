import 'server-only';
import { Prisma } from '@prisma/client';
import type { BatchInput } from '@/server/ingestion/parsers';

type Tx = Prisma.TransactionClient;

function gramsInUnit(grams: number, unit: string): number {
  const normalized = unit.trim().toLowerCase();
  if (normalized === 'kg') return grams / 1_000;
  if (normalized === 'g' || normalized === 'gram') return grams;
  throw new Error(`batch inventory unit must be kg or g, received ${unit}`);
}

export async function upsertImportedRoastBatch(
  tx: Tx,
  batch: BatchInput,
  input: { branchId: string | null; uploadBatchId: string; userId: string | null },
): Promise<{ inserted: boolean; touchedItemIds: string[] }> {
  if (!batch.greenInventoryKey || !batch.roastedInventoryKey) {
    throw new Error(`${batch.batchNumber}: both inventory keys are required`);
  }
  if (!batch.roastedOutputGrams) throw new Error(`${batch.batchNumber}: roasted output is required`);
  if (batch.roastedOutputGrams > batch.greenInputGrams) {
    throw new Error(`${batch.batchNumber}: roasted output cannot exceed green input`);
  }

  const green = await tx.inventoryItem.findUnique({ where: { externalKey: batch.greenInventoryKey } });
  const roasted = await tx.inventoryItem.findUnique({ where: { externalKey: batch.roastedInventoryKey } });
  if (!green) throw new Error(`${batch.batchNumber}: unknown green inventory key ${batch.greenInventoryKey}`);
  if (!roasted) throw new Error(`${batch.batchNumber}: unknown roasted inventory key ${batch.roastedInventoryKey}`);
  if (green.category !== 'GREEN_COFFEE') throw new Error(`${batch.greenInventoryKey} is not green coffee`);
  if (roasted.category !== 'ROASTED') throw new Error(`${batch.roastedInventoryKey} is not roasted inventory`);

  const existing = await tx.roastBatch.findUnique({ where: { batchNumber: batch.batchNumber }, select: { id: true } });
  if (existing) {
    await tx.stockMovement.deleteMany({ where: { roastBatchId: existing.id } });
    await tx.inventoryCostLayer.deleteMany({ where: { roastBatchId: existing.id } });
  }

  const greenQty = gramsInUnit(batch.greenInputGrams, green.unit);
  const roastedQty = gramsInUnit(batch.roastedOutputGrams, roasted.unit);
  const available = await tx.stockMovement.aggregate({
    where: { inventoryItemId: green.id },
    _sum: { quantity: true },
  });
  const availableQty = Number(available._sum.quantity ?? 0);
  if (availableQty + 0.000_5 < greenQty) {
    throw new Error(`${batch.batchNumber}: insufficient ${batch.greenInventoryKey} stock (${availableQty.toFixed(3)} available)`);
  }

  const data = {
    roastDate: batch.roastDate ?? null,
    packagingDate: batch.packagingDate ?? null,
    origin: batch.origin,
    roastLevel: batch.roastLevel ?? null,
    greenInputGrams: batch.greenInputGrams,
    roastedOutputGrams: batch.roastedOutputGrams,
    qcScore: batch.qcScore ?? null,
    qcNotes: batch.qcNotes ?? null,
    branchId: input.branchId,
    uploadBatchId: input.uploadBatchId,
    greenInventoryItemId: green.id,
    roastedInventoryItemId: roasted.id,
    isActive: true,
  };
  const record = existing
    ? await tx.roastBatch.update({ where: { id: existing.id }, data })
    : await tx.roastBatch.create({ data: { batchNumber: batch.batchNumber, ...data } });

  const occurredAt = batch.roastDate ?? new Date();
  const greenUnitCost = Number(green.unitCost ?? 0);
  const roastedUnitCost = roastedQty > 0 ? greenQty * greenUnitCost / roastedQty : 0;
  await tx.stockMovement.createMany({
    data: [
      {
        inventoryItemId: green.id,
        roastBatchId: record.id,
        occurredAt,
        reason: 'PRODUCTION_OUT',
        quantity: new Prisma.Decimal(-greenQty),
        reference: batch.batchNumber,
        externalId: `BATCH:${batch.batchNumber}:GREEN`,
        branchId: input.branchId,
        uploadBatchId: input.uploadBatchId,
      },
      {
        inventoryItemId: roasted.id,
        roastBatchId: record.id,
        occurredAt,
        reason: 'PRODUCTION_IN',
        quantity: new Prisma.Decimal(roastedQty),
        reference: batch.batchNumber,
        externalId: `BATCH:${batch.batchNumber}:ROASTED`,
        branchId: input.branchId,
        uploadBatchId: input.uploadBatchId,
      },
    ],
  });
  await tx.inventoryCostLayer.create({
    data: {
      inventoryItemId: roasted.id,
      roastBatchId: record.id,
      qtyReceived: new Prisma.Decimal(roastedQty),
      unitCost: new Prisma.Decimal(roastedUnitCost.toFixed(3)),
      receivedAt: occurredAt,
    },
  });
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: existing ? 'IMPORT_UPDATE' : 'IMPORT_CREATE',
      entity: 'RoastBatch',
      entityId: record.id,
      metadata: {
        batchNumber: batch.batchNumber,
        greenInventoryKey: batch.greenInventoryKey,
        roastedInventoryKey: batch.roastedInventoryKey,
        greenInputGrams: batch.greenInputGrams,
        roastedOutputGrams: batch.roastedOutputGrams,
      },
    },
  });
  return { inserted: !existing, touchedItemIds: [green.id, roasted.id] };
}
