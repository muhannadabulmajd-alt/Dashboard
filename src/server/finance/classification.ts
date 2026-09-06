'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import type { TrustedCommandContext } from '@/server/commands/actor-context';
import { COMMAND_TRANSACTION_OPTIONS } from '@/server/commands/transaction-checkpoints';
import {
  requireCap,
  resolveCommandActor,
  type CommandCommitHook,
  type CommandPreconditionHook,
} from '@/server/records/shared';
import { syncActiveCost } from '@/server/inventory/fifo';
import { syncAllocatedAssetTotals } from '@/server/finance/asset-allocations';
import {
  captureLayerBaseCosts,
  syncLayerLandedCosts,
} from '@/server/finance/landed-costs';

const VALID_TREATMENTS = new Set(['CAPEX', 'INVENTORY', 'OPEX', 'REVIEW']);

const SpendReclassificationCommandSchema = z.object({
  entryId: z.string().min(1),
  lineId: z.string().min(1),
  spendTreatment: z.enum(['CAPEX', 'INVENTORY', 'OPEX', 'REVIEW']),
  classificationNote: z.string().trim().min(3),
  fixedAssetId: z.string().min(1).nullish(),
  inventoryItemId: z.string().min(1).nullish(),
}).strict();

export type SpendReclassificationCommandInput = z.input<
  typeof SpendReclassificationCommandSchema
>;

function optionalId(formData: FormData, name: string): string | null {
  const value = String(formData.get(name) ?? '').trim();
  return value || null;
}

export async function reclassifyLedgerLineFromInput(
  rawInput: SpendReclassificationCommandInput,
  options: {
    actorContext?: TrustedCommandContext;
    precondition?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<{
      recordId: string;
      entryId: string;
      treatment: 'CAPEX' | 'INVENTORY' | 'OPEX' | 'REVIEW';
    }>;
  } = {},
) {
  const user = await resolveCommandActor('manage:finance', options.actorContext);
  if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) {
    throw new Error('forbidden');
  }
  const input = SpendReclassificationCommandSchema.parse(rawInput);
  const { entryId, lineId, spendTreatment: treatment } = input;
  const note = input.classificationNote;
  const requestedAssetId = input.fixedAssetId ?? null;
  const requestedInventoryItemId = input.inventoryItemId ?? null;
  const touchedInventoryItemIds = new Set<string>();

  return prisma.$transaction(async (tx) => {
    await options.precondition?.(tx);
    const before = await tx.ledgerEntryLine.findFirst({
      where: { id: lineId, financeEntryId: entryId },
      include: {
        financeEntry: { select: { recordKey: true, date: true } },
        fixedAssetCostAllocations: {
          select: { id: true, fixedAssetId: true, amount: true },
        },
        landedCostAllocations: {
          select: { id: true, inventoryItemId: true, costLayerId: true, amount: true },
        },
      },
    });
    if (!before) throw new Error('notfound');
    if (before.inventoryItemId) touchedInventoryItemIds.add(before.inventoryItemId);

    if (before.spendTreatment === 'INVENTORY' && treatment !== 'INVENTORY' && before.inventoryItemId) {
      const remaining = await tx.stockMovement.aggregate({
        where: {
          inventoryItemId: before.inventoryItemId,
          NOT: { financeEntryId: entryId },
        },
        _sum: { quantity: true },
      });
      if (Number(remaining._sum.quantity ?? 0) < 0) throw new Error('inventory_already_consumed');
      await tx.stockMovement.deleteMany({
        where: { financeEntryId: entryId, inventoryItemId: before.inventoryItemId },
      });
      await tx.inventoryCostLayer.deleteMany({
        where: { financeEntryId: entryId, inventoryItemId: before.inventoryItemId },
      });
    }

    const itemType =
      treatment === 'CAPEX'
        ? 'ASSET'
        : treatment === 'INVENTORY'
          ? 'INVENTORY'
          : treatment === 'OPEX'
            ? 'EXPENSE'
            : 'OTHER';
    const nextInventoryItemId =
      treatment === 'INVENTORY'
        ? requestedInventoryItemId ?? before.inventoryItemId
        : null;
    await tx.ledgerEntryLine.update({
      where: { id: lineId },
      data: {
        itemType,
        spendTreatment: treatment as 'CAPEX' | 'INVENTORY' | 'OPEX' | 'REVIEW',
        classificationStatus: treatment === 'REVIEW' ? 'NEEDS_REVIEW' : 'CONFIRMED',
        classificationSource: `owner-admin:${user.id}`,
        classificationNote: note,
        inventoryItemId: nextInventoryItemId,
      },
    });
    if (nextInventoryItemId) touchedInventoryItemIds.add(nextInventoryItemId);

    const assetImportKey = `ASSET:LEDGER_LINE:${lineId}`;
    if (treatment === 'CAPEX') {
      const priorAssetIds = before.fixedAssetCostAllocations.map(
        (allocation) => allocation.fixedAssetId,
      );
      let targetAssetId = requestedAssetId ?? before.fixedAssetCostAllocations[0]?.fixedAssetId ?? null;
      if (requestedAssetId) {
        const target = await tx.fixedAsset.findFirst({
          where: { id: requestedAssetId, isActive: true, archivedAt: null },
          select: { id: true },
        });
        if (!target) throw new Error('asset_notfound');
      }
      if (!targetAssetId) {
        const asset = await tx.fixedAsset.upsert({
          where: { importKey: assetImportKey },
          create: {
            importKey: assetImportKey,
            name: before.itemName,
            category: before.assetCategory ?? 'Equipment',
            quantity: before.quantity,
            unit: before.unit,
            totalCost: before.lineTotal,
            unitCost: before.landedUnitCost,
            purchaseDate: before.financeEntry.date,
            financeEntryId: entryId,
            branchId: before.branchId,
            notes: note,
            isActive: true,
            createdById: user.id,
          },
          update: {
            name: before.itemName,
            category: before.assetCategory ?? 'Equipment',
            quantity: before.quantity,
            unit: before.unit,
            totalCost: before.lineTotal,
            unitCost: before.landedUnitCost,
            notes: note,
            isActive: true,
            archivedAt: null,
            archiveReason: null,
          },
        });
        targetAssetId = asset.id;
      }
      if (!targetAssetId) throw new Error('asset_notfound');
      await tx.fixedAssetCostAllocation.deleteMany({ where: { ledgerLineId: lineId } });
      await tx.fixedAssetCostAllocation.upsert({
        where: { importKey: `${assetImportKey}:ALLOCATION` },
        create: {
          importKey: `${assetImportKey}:ALLOCATION`,
          fixedAssetId: targetAssetId,
          financeEntryId: entryId,
          ledgerLineId: lineId,
          amount: before.lineTotal,
          notes: note,
        },
        update: {
          fixedAssetId: targetAssetId,
          financeEntryId: entryId,
          ledgerLineId: lineId,
          amount: before.lineTotal,
          notes: note,
        },
      });
      await syncAllocatedAssetTotals(tx, [...priorAssetIds, targetAssetId], {
        userId: user.id,
        reason: `Ledger line ${lineId} asset allocation changed`,
      });
    } else {
      const affectedAssetIds = before.fixedAssetCostAllocations.map((allocation) => allocation.fixedAssetId);
      await tx.fixedAssetCostAllocation.deleteMany({ where: { ledgerLineId: lineId } });
      await syncAllocatedAssetTotals(tx, affectedAssetIds, {
        userId: user.id,
        reason: `Reclassified to ${treatment}`,
      });
    }

    if (treatment === 'INVENTORY') {
      const receiptMovement = await tx.stockMovement.findFirst({
        where: { financeEntryId: entryId, inventoryItemId: before.inventoryItemId ?? undefined },
        select: { id: true },
      });
      if (
        receiptMovement &&
        requestedInventoryItemId &&
        requestedInventoryItemId !== before.inventoryItemId
      ) {
        throw new Error('inventory_receipt_locked');
      }

      if (!receiptMovement) {
        const requestedTargetItemId = requestedInventoryItemId ?? nextInventoryItemId;
        const existingTargetLayerId =
          before.landedCostAllocations.find((allocation) =>
            allocation.inventoryItemId === requestedTargetItemId
          )?.costLayerId ?? null;
        const targetLayer = existingTargetLayerId
          ? await tx.inventoryCostLayer.findUnique({
              where: { id: existingTargetLayerId },
              select: { id: true, inventoryItemId: true },
            })
          : requestedTargetItemId
          ? await tx.inventoryCostLayer.findFirst({
              where: { inventoryItemId: requestedTargetItemId },
              orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
              select: { id: true, inventoryItemId: true },
            })
          : null;
        if (requestedTargetItemId && !targetLayer) throw new Error('inventory_layer_notfound');

        const priorLayerIds = before.landedCostAllocations
          .map((allocation) => allocation.costLayerId)
          .filter((value): value is string => Boolean(value));
        const baseCosts = await captureLayerBaseCosts(
          tx,
          targetLayer ? [...priorLayerIds, targetLayer.id] : priorLayerIds,
        );
        const allocationKey = `LANDED:PENDING:${lineId}`;
        const currentAllocation = before.landedCostAllocations[0] ?? null;
        if (currentAllocation) {
          await tx.inventoryLandedCostAllocation.update({
            where: { id: currentAllocation.id },
            data: {
              inventoryItemId: targetLayer?.inventoryItemId ?? nextInventoryItemId,
              costLayerId: targetLayer?.id ?? null,
              amount: before.lineTotal,
              notes: note,
            },
          });
          await tx.inventoryLandedCostAllocation.deleteMany({
            where: { ledgerLineId: lineId, id: { not: currentAllocation.id } },
          });
        } else {
          await tx.inventoryLandedCostAllocation.upsert({
            where: { importKey: allocationKey },
            create: {
              importKey: allocationKey,
              financeEntryId: entryId,
              ledgerLineId: lineId,
              inventoryItemId: targetLayer?.inventoryItemId ?? nextInventoryItemId,
              costLayerId: targetLayer?.id ?? null,
              amount: before.lineTotal,
              notes: note,
            },
            update: {
              inventoryItemId: targetLayer?.inventoryItemId ?? nextInventoryItemId,
              costLayerId: targetLayer?.id ?? null,
              amount: before.lineTotal,
              notes: note,
            },
          });
        }
        const recalculatedItems = await syncLayerLandedCosts(tx, baseCosts);
        for (const itemId of recalculatedItems) touchedInventoryItemIds.add(itemId);
      }
    } else {
      const priorLayerIds = before.landedCostAllocations
        .map((allocation) => allocation.costLayerId)
        .filter((value): value is string => Boolean(value));
      const baseCosts = await captureLayerBaseCosts(tx, priorLayerIds);
      await tx.inventoryLandedCostAllocation.deleteMany({ where: { ledgerLineId: lineId } });
      const recalculatedItems = await syncLayerLandedCosts(tx, baseCosts);
      for (const itemId of recalculatedItems) touchedInventoryItemIds.add(itemId);
    }

    const treatments = await tx.ledgerEntryLine.findMany({
      where: { financeEntryId: entryId },
      select: { spendTreatment: true },
    });
    const hasPurchase = treatments.some(
      (line) => line.spendTreatment === 'CAPEX' || line.spendTreatment === 'INVENTORY',
    );
    const hasOperating = treatments.some(
      (line) => line.spendTreatment === 'OPEX' || line.spendTreatment === 'REVIEW',
    );
    await tx.financeEntry.update({
      where: { id: entryId },
      data: {
        type: hasPurchase ? 'PURCHASE' : 'EXPENSE',
        recordClass: hasPurchase && hasOperating ? 'MIXED' : hasPurchase ? 'PURCHASE' : 'EXPENSE',
      },
    });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'RECLASSIFY_LEDGER_LINE',
        entity: 'LedgerEntryLine',
        entityId: lineId,
        metadata: {
          recordKey: before.financeEntry.recordKey,
          before: {
            spendTreatment: before.spendTreatment,
            classificationStatus: before.classificationStatus,
            itemType: before.itemType,
          },
          after: { spendTreatment: treatment, itemType, note },
          assetId: treatment === 'CAPEX' ? requestedAssetId : null,
          inventoryItemId: treatment === 'INVENTORY' ? nextInventoryItemId : null,
          amount: before.lineTotal,
        },
      },
    });
    for (const inventoryItemId of touchedInventoryItemIds) {
      await syncActiveCost(inventoryItemId, tx);
    }
    const result = {
      recordId: lineId,
      entryId,
      treatment,
    };
    await options.onCommitted?.(tx, result);
    return result;
  }, COMMAND_TRANSACTION_OPTIONS);
}

export async function reclassifyLedgerLine(
  entryId: string,
  lineId: string,
  formData: FormData,
): Promise<void> {
  const treatment = String(formData.get('spendTreatment') ?? '');
  const note = String(formData.get('classificationNote') ?? '').trim();
  if (!VALID_TREATMENTS.has(treatment) || !note) throw new Error('invalid');
  await reclassifyLedgerLineFromInput({
    entryId,
    lineId,
    spendTreatment: treatment as 'CAPEX' | 'INVENTORY' | 'OPEX' | 'REVIEW',
    classificationNote: note,
    fixedAssetId: optionalId(formData, 'fixedAssetId'),
    inventoryItemId: optionalId(formData, 'inventoryItemId'),
  });

  revalidatePath('/[locale]/(dashboard)/finance', 'page');
  revalidatePath('/[locale]/(dashboard)/finance/ledger/[id]', 'page');
  revalidatePath('/[locale]/(dashboard)/pnl', 'page');
  revalidatePath('/[locale]/(dashboard)/balance-sheet', 'page');
}

export async function splitLedgerLine(
  entryId: string,
  lineId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireCap('manage:finance');
  if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) {
    throw new Error('forbidden');
  }
  const splitAmount = Math.round(Number(formData.get('splitAmount')));
  const treatment = String(formData.get('splitTreatment') ?? '');
  const note = String(formData.get('splitNote') ?? '').trim();
  if (
    !Number.isSafeInteger(splitAmount) ||
    splitAmount <= 0 ||
    !VALID_TREATMENTS.has(treatment) ||
    treatment === 'REVIEW' ||
    !note
  ) {
    throw new Error('invalid');
  }

  await prisma.$transaction(async (tx) => {
    const before = await tx.ledgerEntryLine.findFirst({
      where: { id: lineId, financeEntryId: entryId },
      include: {
        financeEntry: {
          select: {
            recordKey: true,
            date: true,
            partyId: true,
            branchId: true,
          },
        },
        fixedAssetCostAllocations: { select: { id: true } },
        landedCostAllocations: { select: { id: true } },
      },
    });
    if (!before) throw new Error('notfound');
    if (
      splitAmount >= before.lineTotal ||
      before.inventoryItemId ||
      before.fixedAssetCostAllocations.length ||
      before.landedCostAllocations.length
    ) {
      throw new Error('split_not_allowed');
    }

    const nextLineNo = (
      await tx.ledgerEntryLine.aggregate({
        where: { financeEntryId: entryId },
        _max: { lineNo: true },
      })
    )._max.lineNo ?? 0;
    const remainingAmount = before.lineTotal - splitAmount;
    await tx.ledgerEntryLine.update({
      where: { id: lineId },
      data: {
        quantity: 1,
        unit: 'unit',
        unitCost: remainingAmount,
        landedUnitCost: remainingAmount,
        discountAmount: 0,
        extraAmount: 0,
        lineTotal: remainingAmount,
        classificationStatus:
          before.spendTreatment === 'REVIEW' ? 'NEEDS_REVIEW' : 'CONFIRMED',
        classificationSource: `owner-admin-split:${user.id}`,
        classificationNote: before.classificationNote
          ? `${before.classificationNote} Split IQD ${splitAmount}: ${note}`
          : `Split IQD ${splitAmount}: ${note}`,
      },
    });

    const itemType =
      treatment === 'CAPEX'
        ? 'ASSET'
        : treatment === 'INVENTORY'
          ? 'INVENTORY'
          : 'EXPENSE';
    const splitLine = await tx.ledgerEntryLine.create({
      data: {
        financeEntryId: entryId,
        lineNo: nextLineNo + 1,
        itemType,
        itemName: `${before.itemName} (split)`,
        assetCategory: treatment === 'CAPEX' ? before.assetCategory ?? 'Equipment' : null,
        categoryType: treatment === 'CAPEX' ? 'EQUIPMENT' : before.categoryType,
        unit: 'unit',
        quantity: 1,
        unitCost: splitAmount,
        landedUnitCost: splitAmount,
        lineTotal: splitAmount,
        branchId: before.branchId,
        notes: note,
        spendTreatment: treatment as 'CAPEX' | 'INVENTORY' | 'OPEX',
        classificationStatus: 'CONFIRMED',
        classificationSource: `owner-admin-split:${user.id}`,
        classificationNote: note,
      },
    });

    if (treatment === 'CAPEX') {
      const importKey = `ASSET:LEDGER_LINE:${splitLine.id}`;
      const asset = await tx.fixedAsset.create({
        data: {
          importKey,
          name: splitLine.itemName,
          category: before.assetCategory ?? 'Equipment',
          quantity: 1,
          unit: 'asset',
          totalCost: splitAmount,
          unitCost: splitAmount,
          purchaseDate: before.financeEntry.date,
          partyId: before.financeEntry.partyId,
          branchId: before.branchId ?? before.financeEntry.branchId,
          financeEntryId: entryId,
          notes: note,
          createdById: user.id,
        },
      });
      await tx.fixedAssetCostAllocation.create({
        data: {
          importKey: `${importKey}:ALLOCATION`,
          fixedAssetId: asset.id,
          financeEntryId: entryId,
          ledgerLineId: splitLine.id,
          amount: splitAmount,
          notes: note,
        },
      });
    } else if (treatment === 'INVENTORY') {
      await tx.inventoryLandedCostAllocation.create({
        data: {
          importKey: `LANDED:PENDING:${splitLine.id}`,
          financeEntryId: entryId,
          ledgerLineId: splitLine.id,
          amount: splitAmount,
          notes: note,
        },
      });
    }

    const treatments = await tx.ledgerEntryLine.findMany({
      where: { financeEntryId: entryId },
      select: { spendTreatment: true },
    });
    const hasPurchase = treatments.some(
      (line) => line.spendTreatment === 'CAPEX' || line.spendTreatment === 'INVENTORY',
    );
    const hasOperating = treatments.some(
      (line) => line.spendTreatment === 'OPEX' || line.spendTreatment === 'REVIEW',
    );
    await tx.financeEntry.update({
      where: { id: entryId },
      data: {
        type: hasPurchase ? 'PURCHASE' : 'EXPENSE',
        recordClass: hasPurchase && hasOperating ? 'MIXED' : hasPurchase ? 'PURCHASE' : 'EXPENSE',
      },
    });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'SPLIT_LEDGER_LINE',
        entity: 'LedgerEntryLine',
        entityId: lineId,
        metadata: {
          recordKey: before.financeEntry.recordKey,
          originalAmount: before.lineTotal,
          remainingAmount,
          splitAmount,
          originalTreatment: before.spendTreatment,
          splitTreatment: treatment,
          splitLineId: splitLine.id,
          reason: note,
        },
      },
    });
  });

  revalidatePath('/[locale]/(dashboard)/finance', 'page');
  revalidatePath('/[locale]/(dashboard)/finance/ledger/[id]', 'page');
  revalidatePath('/[locale]/(dashboard)/pnl', 'page');
  revalidatePath('/[locale]/(dashboard)/balance-sheet', 'page');
}
