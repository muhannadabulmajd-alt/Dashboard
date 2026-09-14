import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/session';
import { prisma } from '@/server/db/client';
import { COMMAND_TRANSACTION_OPTIONS } from '@/server/commands/transaction-checkpoints';
import { requireInventoryV2Enabled } from './config';
import { inventoryCommandError } from './errors';
import {
  finishedGoodsCategoryForProductLine,
  finishedGoodsDefinitionState,
  finishedGoodsExternalKey,
} from './finished-goods-contracts';
import { auditStockCommand, bumpLocationVersion } from './internal';
import { inventoryReadTransaction } from './read-transaction';

const idempotencyKey = z.string().trim().min(8).max(191);

export const BootstrapFinishedGoodsCommandSchema = z.object({
  idempotencyKey,
  expectedCentralLocationVersion: z.coerce.number().int().positive(),
}).strict();

type BootstrapResult = {
  centralLocationId: string;
  createdItemIds: string[];
  createdItemCount: number;
  configuredPolicyCount: number;
  stockVersion: number;
  replayed: boolean;
};

type ProductDefinition = {
  id: string;
  sku: string;
  nameEn: string;
  nameAr: string;
  productLine: string;
  sellUnit: string;
  cogsPerUnit: number;
  inventoryItems: Array<{
    id: string;
    category: string;
    branchId: string | null;
    locationPolicies: Array<{ isActive: boolean; canSell: boolean }>;
  }>;
};

function assertSetupActor(actor: CurrentUser): void {
  if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') throw new Error('forbidden');
}

function commandHash(actorId: string, expectedVersion: number): string {
  return createHash('sha256')
    .update(JSON.stringify({ actorId, expectedCentralLocationVersion: expectedVersion }))
    .digest('hex');
}

function parseReplay(
  metadata: Prisma.JsonValue | null,
  actorId: string,
  inputHash: string,
): BootstrapResult | null {
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') return null;
  const row = metadata as Record<string, unknown>;
  if (row.actorId !== actorId || row.inputHash !== inputHash) throw new Error('idempotency_conflict');
  if (
    typeof row.centralLocationId !== 'string' ||
    !Array.isArray(row.createdItemIds) ||
    row.createdItemIds.some((value) => typeof value !== 'string') ||
    typeof row.configuredPolicyCount !== 'number' ||
    typeof row.stockVersion !== 'number'
  ) {
    return null;
  }
  return {
    centralLocationId: row.centralLocationId,
    createdItemIds: row.createdItemIds as string[],
    createdItemCount: row.createdItemIds.length,
    configuredPolicyCount: row.configuredPolicyCount,
    stockVersion: row.stockVersion,
    replayed: true,
  };
}

async function trackedProductDefinitions(
  tx: Prisma.TransactionClient,
  centralLocationId: string,
): Promise<ProductDefinition[]> {
  return tx.product.findMany({
    where: { isActive: true, trackInventory: true },
    select: {
      id: true,
      sku: true,
      nameEn: true,
      nameAr: true,
      productLine: true,
      sellUnit: true,
      cogsPerUnit: true,
      inventoryItems: {
        where: { isActive: true },
        select: {
          id: true,
          category: true,
          branchId: true,
          locationPolicies: {
            where: { locationId: centralLocationId },
            select: { isActive: true, canSell: true },
          },
        },
      },
    },
    orderBy: { sku: 'asc' },
  });
}

export async function getFinishedGoodsBootstrapReadiness() {
  const centralLocations = await prisma.stockLocation.findMany({
    where: { isActive: true, isCentralFulfillment: true },
    select: { id: true, code: true, nameEn: true, nameAr: true, stockVersion: true },
    orderBy: { code: 'asc' },
  });
  if (centralLocations.length !== 1) {
    return {
      centralLocation: null,
      centralLocationCount: centralLocations.length,
      missingDefinitionCount: 0,
      missingPolicyCount: 0,
      conflicts: [] as string[],
    };
  }
  const centralLocation = centralLocations[0];
  const products = await inventoryReadTransaction((tx) => trackedProductDefinitions(tx, centralLocation.id));
  const missing = products.filter((product) => finishedGoodsDefinitionState(product.inventoryItems) === 'MISSING');
  const ready = products.filter((product) => finishedGoodsDefinitionState(product.inventoryItems) === 'READY');
  const conflicts = products
    .filter((product) => finishedGoodsDefinitionState(product.inventoryItems) === 'CONFLICT')
    .map((product) => product.sku);
  const missingPolicyCount = ready.filter((product) => {
    const policy = product.inventoryItems[0]?.locationPolicies[0];
    return !policy?.isActive || !policy.canSell;
  }).length;
  return {
    centralLocation,
    centralLocationCount: 1,
    missingDefinitionCount: missing.length,
    missingPolicyCount,
    conflicts,
  };
}

export async function bootstrapFinishedGoodsDefinitions(
  actor: CurrentUser,
  rawInput: z.input<typeof BootstrapFinishedGoodsCommandSchema>,
): Promise<BootstrapResult> {
  requireInventoryV2Enabled();
  assertSetupActor(actor);
  try {
    const input = BootstrapFinishedGoodsCommandSchema.parse(rawInput);
    const inputHash = commandHash(actor.id, input.expectedCentralLocationVersion);
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ locked: number }>>`
        SELECT 1 AS locked
        WHERE pg_advisory_xact_lock(hashtext('inventory-v2-finished-goods-bootstrap')) IS NULL
      `;
      const previous = await tx.auditLog.findFirst({
        where: {
          action: 'BOOTSTRAP_FINISHED_GOODS',
          entity: 'InventorySetup',
          entityId: input.idempotencyKey,
        },
        select: { metadata: true },
      });
      if (previous) {
        const replay = parseReplay(previous.metadata, actor.id, inputHash);
        if (!replay) throw new Error('idempotency_conflict');
        return replay;
      }

      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "StockLocation"
        WHERE "isActive" = true AND "isCentralFulfillment" = true
        ORDER BY "id" FOR UPDATE
      `;
      const centralLocations = await tx.stockLocation.findMany({
        where: { isActive: true, isCentralFulfillment: true },
        select: { id: true, stockVersion: true },
      });
      if (centralLocations.length !== 1) throw new Error('central_fulfillment_location_required');
      const central = centralLocations[0];
      if (central.stockVersion !== input.expectedCentralLocationVersion) throw new Error('location_stale');

      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Product"
        WHERE "isActive" = true AND "trackInventory" = true
        ORDER BY "id" FOR UPDATE
      `;
      const products = await trackedProductDefinitions(tx, central.id);
      const conflicts = products.filter(
        (product) => finishedGoodsDefinitionState(product.inventoryItems) === 'CONFLICT',
      );
      if (conflicts.length) {
        throw new Error(`finished_goods_definition_conflict:${conflicts.map((row) => row.sku).join(',')}`);
      }

      const occupiedKeys = new Set((await tx.inventoryItem.findMany({
        where: { externalKey: { not: null } },
        select: { externalKey: true },
      })).flatMap((row) => row.externalKey ? [row.externalKey] : []));
      const createdItemIds: string[] = [];
      let configuredPolicyCount = 0;

      for (const product of products) {
        const state = finishedGoodsDefinitionState(product.inventoryItems);
        let inventoryItemId: string;
        if (state === 'MISSING') {
          const externalKey = finishedGoodsExternalKey(product.sku, product.id, occupiedKeys);
          occupiedKeys.add(externalKey);
          const item = await tx.inventoryItem.create({
            data: {
              externalKey,
              category: finishedGoodsCategoryForProductLine(product.productLine),
              productId: product.id,
              nameEn: product.nameEn,
              nameAr: product.nameAr,
              unit: product.sellUnit.trim() || 'unit',
              unitCost: product.cogsPerUnit.toFixed(3),
              branchId: null,
              isActive: true,
            },
            select: { id: true },
          });
          inventoryItemId = item.id;
          createdItemIds.push(item.id);
          await auditStockCommand(tx, actor, 'CREATE_FINISHED_GOODS_DEFINITION', 'InventoryItem', item.id, {
            productId: product.id,
            sku: product.sku,
            centralLocationId: central.id,
            zeroBalance: true,
          });
        } else {
          inventoryItemId = product.inventoryItems[0].id;
        }

        const currentPolicy = state === 'READY'
          ? product.inventoryItems[0].locationPolicies[0]
          : null;
        if (!currentPolicy?.isActive || !currentPolicy.canSell) {
          const policy = await tx.inventoryLocationPolicy.upsert({
            where: {
              inventoryItemId_locationId: {
                inventoryItemId,
                locationId: central.id,
              },
            },
            create: {
              inventoryItemId,
              locationId: central.id,
              canSell: true,
              canProduce: false,
              isActive: true,
            },
            update: { canSell: true, isActive: true },
          });
          configuredPolicyCount += 1;
          await auditStockCommand(
            tx,
            actor,
            'UPSERT_CENTRAL_FINISHED_GOODS_POLICY',
            'InventoryLocationPolicy',
            policy.id,
            { inventoryItemId, productId: product.id, sku: product.sku, locationId: central.id },
          );
        }
      }

      const changed = createdItemIds.length > 0 || configuredPolicyCount > 0;
      const stockVersion = changed
        ? await bumpLocationVersion(tx, central.id)
        : central.stockVersion;
      const result: BootstrapResult = {
        centralLocationId: central.id,
        createdItemIds,
        createdItemCount: createdItemIds.length,
        configuredPolicyCount,
        stockVersion,
        replayed: false,
      };
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: 'BOOTSTRAP_FINISHED_GOODS',
          entity: 'InventorySetup',
          entityId: input.idempotencyKey,
          metadata: {
            actorId: actor.id,
            inputHash,
            centralLocationId: result.centralLocationId,
            createdItemIds: result.createdItemIds,
            configuredPolicyCount: result.configuredPolicyCount,
            stockVersion: result.stockVersion,
          },
        },
      });
      return result;
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'bootstrap_finished_goods');
  }
}
