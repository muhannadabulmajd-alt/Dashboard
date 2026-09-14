import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name.toLowerCase()}_required`);
  return value;
}

function requireIsolatedPreview(): void {
  if (process.env.INVENTORY_V2_DATABASE_ISOLATED !== 'true') {
    throw new Error('inventory_v2_preview_requires_isolated_database');
  }
  const databaseUrl = requiredEnv('DATABASE_URL');
  const expectedHost = requiredEnv('INVENTORY_V2_EXPECTED_DB_HOST');
  const actualHost = new URL(databaseUrl).hostname;
  if (actualHost !== expectedHost || !actualHost.endsWith('.neon.tech')) {
    throw new Error('inventory_v2_preview_database_identity_mismatch');
  }
}

function safeRunId(): string {
  const raw = requiredEnv('INVENTORY_V2_E2E_RUN_ID');
  const value = raw.replace(/[^a-zA-Z0-9]/g, '').slice(-18);
  if (!value) throw new Error('inventory_v2_preview_run_id_invalid');
  return value.toLowerCase();
}

async function main(): Promise<void> {
  requireIsolatedPreview();
  const password = requiredEnv('INVENTORY_V2_E2E_PASSWORD');
  if (password.length < 24) throw new Error('inventory_v2_preview_password_invalid');

  const runId = safeRunId();
  const marker = `inventory-v2-preview-${runId}`;
  const hashedPassword = await bcrypt.hash(password, 10);

  const fixture = await prisma.$transaction(async (tx) => {
    const branch = await tx.branch.create({
      data: {
        code: `IV2-${runId.toUpperCase()}`,
        nameEn: `Inventory V2 Preview ${runId}`,
        nameAr: `Inventory V2 Preview ${runId}`,
        branchType: 'COMPANY',
        governorate: 'BAGHDAD',
        city: 'Baghdad',
        address: marker,
        hasPos: true,
        hasWarehouse: true,
        trackInventory: true,
      },
      select: { id: true },
    });

    const warehouse = await tx.stockLocation.create({
      data: {
        branchId: branch.id,
        code: `IV2-${runId.toUpperCase()}-WH`,
        nameEn: `Preview warehouse ${runId}`,
        nameAr: `Preview warehouse ${runId}`,
        type: 'FINISHED_WAREHOUSE',
      },
      select: { id: true, nameEn: true },
    });
    const salesPoint = await tx.stockLocation.create({
      data: {
        branchId: branch.id,
        code: `IV2-${runId.toUpperCase()}-SP`,
        nameEn: `Preview sales point ${runId}`,
        nameAr: `Preview sales point ${runId}`,
        type: 'SALES_POINT',
      },
      select: { id: true, nameEn: true },
    });
    const item = await tx.inventoryItem.create({
      data: {
        externalKey: `IV2_${runId.toUpperCase()}_PACKAGING`,
        category: 'PACKAGING',
        nameEn: `Preview packaging ${runId}`,
        nameAr: `Preview packaging ${runId}`,
        unit: 'unit',
        branchId: branch.id,
      },
      select: { id: true, nameEn: true },
    });
    await tx.inventoryLocationPolicy.createMany({
      data: [
        {
          inventoryItemId: item.id,
          locationId: warehouse.id,
          canProduce: true,
          reorderPoint: '5.000',
          targetLevel: '25.000',
        },
        {
          inventoryItemId: item.id,
          locationId: salesPoint.id,
          reorderPoint: '2.000',
          targetLevel: '10.000',
        },
      ],
    });
    const supplier = await tx.party.create({
      data: {
        externalKey: `IV2_${runId.toUpperCase()}_SUPPLIER`,
        name: `Preview supplier ${runId}`,
        type: 'SUPPLIER',
        branchId: branch.id,
        notes: marker,
      },
      select: { id: true, name: true },
    });
    const cashAccount = await tx.financeAccount.create({
      data: {
        externalKey: `IV2_${runId.toUpperCase()}_CASH`,
        name: `Preview sales cash ${runId}`,
        type: 'CASH',
        branchId: branch.id,
        stockLocationId: salesPoint.id,
        currency: 'IQD',
      },
      select: { id: true },
    });

    const ownerEmail = `inventory-v2-owner-${runId}@laheeb.test`;
    const managerEmail = `inventory-v2-manager-${runId}@laheeb.test`;
    await tx.user.create({
      data: {
        email: ownerEmail,
        name: `Inventory V2 Preview Owner ${runId}`,
        hashedPassword,
        role: 'OWNER',
        branchId: branch.id,
        defaultStockLocationId: warehouse.id,
        defaultFinanceAccountId: cashAccount.id,
        isActive: true,
      },
    });
    const manager = await tx.user.create({
      data: {
        email: managerEmail,
        name: `Inventory V2 Preview Manager ${runId}`,
        hashedPassword,
        role: 'BRANCH_MANAGER',
        branchId: branch.id,
        defaultStockLocationId: salesPoint.id,
        defaultFinanceAccountId: cashAccount.id,
        isActive: true,
      },
      select: { id: true },
    });
    await tx.userLocationAccess.create({
      data: {
        userId: manager.id,
        locationId: salesPoint.id,
        canView: true,
        canSell: true,
        canReceive: true,
        canCount: true,
        canRecordExpense: true,
      },
    });

    return {
      ownerEmail,
      managerEmail,
      itemId: item.id,
      itemName: item.nameEn,
      warehouseId: warehouse.id,
      warehouseName: warehouse.nameEn,
      salesPointId: salesPoint.id,
      salesPointName: salesPoint.nameEn,
      supplierId: supplier.id,
      supplierName: supplier.name,
    };
  });

  process.stdout.write(JSON.stringify(fixture));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'inventory_v2_preview_fixture_failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
