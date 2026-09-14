import 'server-only';
import { z } from 'zod';
import type { CurrentUser } from '@/server/auth/session';
import { decimalNumber } from '@/lib/decimal';
import { prisma } from '@/server/db/client';
import { COMMAND_TRANSACTION_OPTIONS } from '@/server/commands/transaction-checkpoints';
import { requireInventoryV2Enabled } from './config';
import { auditStockCommand, bumpLocationVersion, lockLocation } from './internal';

const id = z.string().trim().min(1).max(191);
const optionalQuantity = z.coerce.number().nonnegative().refine(
  (value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-8,
  'quantity_precision',
).optional();
const optionalAccountCode = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._/-]+$/, 'account_code_invalid').optional();

export const StockLocationSetupSchema = z.object({
  id: id.optional(),
  branchId: id,
  code: z.string().trim().min(2).max(50).transform((value) => value.toUpperCase()),
  nameEn: z.string().trim().min(2).max(120),
  nameAr: z.string().trim().min(2).max(120),
  type: z.enum([
    'RAW_WAREHOUSE',
    'ROASTERY',
    'PACKING',
    'FINISHED_WAREHOUSE',
    'SALES_POINT',
    'IN_TRANSIT',
    'QUARANTINE',
    'GENERAL',
  ]),
  isActive: z.boolean().default(true),
  isCentralFulfillment: z.boolean().default(false),
}).strict();

export const InventoryLocationPolicySetupSchema = z.object({
  inventoryItemId: id,
  locationId: id,
  reorderPoint: optionalQuantity,
  targetLevel: optionalQuantity,
  canSell: z.boolean().default(false),
  canProduce: z.boolean().default(false),
  isActive: z.boolean().default(true),
  expectedLocationVersion: z.coerce.number().int().positive(),
}).strict();

export const InventoryVariancePolicySetupSchema = z.object({
  locationId: id,
  isActive: z.boolean().default(false),
  openingBalanceAccountCode: optionalAccountCode,
  inventoryGainAccountCode: optionalAccountCode,
  inventoryLossAccountCode: optionalAccountCode,
  expectedLocationVersion: z.coerce.number().int().positive(),
}).strict().superRefine((value, context) => {
  if (!value.isActive) return;
  for (const field of [
    'openingBalanceAccountCode',
    'inventoryGainAccountCode',
    'inventoryLossAccountCode',
  ] as const) {
    if (!value[field]) {
      context.addIssue({ code: 'custom', path: [field], message: 'variance_account_code_required' });
    }
  }
});

const UserLocationAccessRowSchema = z.object({
  locationId: id,
  canView: z.boolean().default(true),
  canSell: z.boolean().default(false),
  canReceive: z.boolean().default(false),
  canCount: z.boolean().default(false),
  canRecordExpense: z.boolean().default(false),
  canProduce: z.boolean().default(false),
  canDispatch: z.boolean().default(false),
  canApprove: z.boolean().default(false),
}).strict();

export const UserLocationAccessSetupSchema = z.object({
  userId: id,
  defaultLocationId: id.nullish(),
  accesses: z.array(UserLocationAccessRowSchema).max(200),
}).strict().superRefine((value, context) => {
  const ids = value.accesses.map((row) => row.locationId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', path: ['accesses'], message: 'duplicate_location' });
  }
  if (
    value.defaultLocationId &&
    !value.accesses.some((row) => row.locationId === value.defaultLocationId && row.canView)
  ) {
    context.addIssue({ code: 'custom', path: ['defaultLocationId'], message: 'default_location_not_allowed' });
  }
});

function assertSetupActor(actor: CurrentUser): void {
  if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') throw new Error('forbidden');
}

export async function saveStockLocation(
  actor: CurrentUser,
  rawInput: z.input<typeof StockLocationSetupSchema>,
) {
  requireInventoryV2Enabled();
  assertSetupActor(actor);
  const input = StockLocationSetupSchema.parse(rawInput);
  if (input.isCentralFulfillment && input.type !== 'FINISHED_WAREHOUSE') {
    throw new Error('central_fulfillment_must_be_finished_warehouse');
  }

  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findFirst({
      where: { id: input.branchId, isActive: true },
      select: { id: true },
    });
    if (!branch) throw new Error('branch_not_found');
    const current = input.id
      ? await tx.stockLocation.findUnique({ where: { id: input.id } })
      : null;
    if (input.id && !current) throw new Error('location_not_found');
    if (current && current.branchId !== input.branchId) {
      const used = await tx.stockMovement.count({ where: { locationId: current.id } });
      if (used) throw new Error('location_branch_immutable');
    }
    if (current?.isActive && !input.isActive) {
      const [balance, activeReservations] = await Promise.all([
        tx.stockMovement.aggregate({
          where: { locationId: current.id },
          _sum: { quantity: true },
        }),
        tx.stockReservation.count({ where: { locationId: current.id, status: 'ACTIVE' } }),
      ]);
      if (Math.abs(decimalNumber(balance._sum.quantity)) > 1e-9 || activeReservations > 0) {
        throw new Error('location_not_empty');
      }
    }
    if (input.isCentralFulfillment) {
      await tx.stockLocation.updateMany({
        where: { isCentralFulfillment: true, ...(input.id ? { id: { not: input.id } } : {}) },
        data: { isCentralFulfillment: false },
      });
    }
    const location = input.id
      ? await tx.stockLocation.update({
          where: { id: input.id },
          data: {
            branchId: input.branchId,
            code: input.code,
            nameEn: input.nameEn,
            nameAr: input.nameAr,
            type: input.type,
            isActive: input.isActive,
            isCentralFulfillment: input.isCentralFulfillment,
          },
        })
      : await tx.stockLocation.create({
          data: {
            branchId: input.branchId,
            code: input.code,
            nameEn: input.nameEn,
            nameAr: input.nameAr,
            type: input.type,
            isActive: input.isActive,
            isCentralFulfillment: input.isCentralFulfillment,
          },
        });
    await auditStockCommand(
      tx,
      actor,
      current ? 'UPDATE_STOCK_LOCATION' : 'CREATE_STOCK_LOCATION',
      'StockLocation',
      location.id,
      {
        branchId: location.branchId,
        code: location.code,
        type: location.type,
        isActive: location.isActive,
        isCentralFulfillment: location.isCentralFulfillment,
      },
    );
    return location;
  }, COMMAND_TRANSACTION_OPTIONS);
}

export async function saveInventoryLocationPolicy(
  actor: CurrentUser,
  rawInput: z.input<typeof InventoryLocationPolicySetupSchema>,
) {
  requireInventoryV2Enabled();
  assertSetupActor(actor);
  const input = InventoryLocationPolicySetupSchema.parse(rawInput);
  return prisma.$transaction(async (tx) => {
    const item = await tx.inventoryItem.findUnique({
      where: { id: input.inventoryItemId },
      select: { id: true, category: true },
    });
    const location = await lockLocation(
      tx,
      actor,
      input.locationId,
      'approve',
      input.expectedLocationVersion,
    );
    if (!item) throw new Error('inventory_item_not_found');
    if (input.canSell && item.category !== 'FINISHED_GOOD' && item.category !== 'ACCESSORY') {
      throw new Error('only_finished_goods_can_be_sold');
    }
    const policy = await tx.inventoryLocationPolicy.upsert({
      where: {
        inventoryItemId_locationId: {
          inventoryItemId: input.inventoryItemId,
          locationId: input.locationId,
        },
      },
      create: {
        inventoryItemId: input.inventoryItemId,
        locationId: input.locationId,
        reorderPoint: input.reorderPoint,
        targetLevel: input.targetLevel,
        canSell: input.canSell,
        canProduce: input.canProduce,
        isActive: input.isActive,
      },
      update: {
        reorderPoint: input.reorderPoint ?? null,
        targetLevel: input.targetLevel ?? null,
        canSell: input.canSell,
        canProduce: input.canProduce,
        isActive: input.isActive,
      },
    });
    const stockVersion = await bumpLocationVersion(tx, location.id);
    await auditStockCommand(tx, actor, 'UPSERT_INVENTORY_LOCATION_POLICY', 'InventoryLocationPolicy', policy.id, {
      inventoryItemId: input.inventoryItemId,
      locationId: input.locationId,
      reorderPoint: input.reorderPoint ?? null,
      targetLevel: input.targetLevel ?? null,
      canSell: input.canSell,
      canProduce: input.canProduce,
      isActive: input.isActive,
      stockVersion,
    });
    return { policy, stockVersion };
  }, COMMAND_TRANSACTION_OPTIONS);
}

export async function saveInventoryVariancePolicy(
  actor: CurrentUser,
  rawInput: z.input<typeof InventoryVariancePolicySetupSchema>,
) {
  requireInventoryV2Enabled();
  assertSetupActor(actor);
  const input = InventoryVariancePolicySetupSchema.parse(rawInput);
  return prisma.$transaction(async (tx) => {
    const location = await lockLocation(
      tx,
      actor,
      input.locationId,
      'approve',
      input.expectedLocationVersion,
    );
    const policy = await tx.inventoryVariancePolicy.upsert({
      where: { locationId: input.locationId },
      create: {
        locationId: input.locationId,
        isActive: input.isActive,
        openingBalanceAccountCode: input.openingBalanceAccountCode ?? null,
        inventoryGainAccountCode: input.inventoryGainAccountCode ?? null,
        inventoryLossAccountCode: input.inventoryLossAccountCode ?? null,
      },
      update: {
        isActive: input.isActive,
        openingBalanceAccountCode: input.openingBalanceAccountCode ?? null,
        inventoryGainAccountCode: input.inventoryGainAccountCode ?? null,
        inventoryLossAccountCode: input.inventoryLossAccountCode ?? null,
      },
    });
    const stockVersion = await bumpLocationVersion(tx, location.id);
    await auditStockCommand(tx, actor, 'UPSERT_INVENTORY_VARIANCE_POLICY', 'InventoryVariancePolicy', policy.id, {
      locationId: location.id,
      isActive: policy.isActive,
      openingBalanceAccountCode: policy.openingBalanceAccountCode,
      inventoryGainAccountCode: policy.inventoryGainAccountCode,
      inventoryLossAccountCode: policy.inventoryLossAccountCode,
      stockVersion,
    });
    return { policy, stockVersion };
  }, COMMAND_TRANSACTION_OPTIONS);
}

export async function replaceUserLocationAccess(
  actor: CurrentUser,
  rawInput: z.input<typeof UserLocationAccessSetupSchema>,
) {
  requireInventoryV2Enabled();
  assertSetupActor(actor);
  const input = UserLocationAccessSetupSchema.parse(rawInput);
  return prisma.$transaction(async (tx) => {
    const [target, locations] = await Promise.all([
      tx.user.findUnique({ where: { id: input.userId }, select: { id: true, role: true, isActive: true } }),
      tx.stockLocation.findMany({
        where: { id: { in: input.accesses.map((row) => row.locationId) }, isActive: true },
        select: { id: true, branchId: true },
      }),
    ]);
    if (!target?.isActive) throw new Error('user_not_found');
    if (locations.length !== input.accesses.length) throw new Error('location_not_found');
    await tx.userLocationAccess.deleteMany({ where: { userId: input.userId } });
    if (input.accesses.length) {
      await tx.userLocationAccess.createMany({
        data: input.accesses.map((row) => ({ userId: input.userId, ...row })),
      });
    }
    const defaultLocation = input.defaultLocationId
      ? locations.find((location) => location.id === input.defaultLocationId)
      : null;
    await tx.user.update({
      where: { id: input.userId },
      data: {
        defaultStockLocationId: defaultLocation?.id ?? null,
        branchId: defaultLocation?.branchId ?? null,
      },
    });
    await auditStockCommand(tx, actor, 'REPLACE_USER_LOCATION_ACCESS', 'User', input.userId, {
      defaultLocationId: defaultLocation?.id ?? null,
      accesses: input.accesses,
    });
    return { userId: input.userId, accessCount: input.accesses.length };
  }, COMMAND_TRANSACTION_OPTIONS);
}
