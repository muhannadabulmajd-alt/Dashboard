import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/server/db/client';
import { ingestCsv } from '@/server/ingestion/ingest';
import type { ImportDataset, IngestSummary } from '@/server/ingestion/parsers';

const packageDir = process.argv.find((arg) => arg.startsWith('--dir='))?.slice(6);
const apply = process.argv.includes('--apply');
if (!packageDir) throw new Error('usage: pnpm check:import-package --dir=/path/to/package [--apply]');
const validatedPackageDir: string = packageDir;

const files: { dataset: ImportDataset; name: string }[] = [
  { dataset: 'customers', name: 'laheeb-filled-customers-v3.csv' },
  { dataset: 'orders', name: 'laheeb-filled-orders-v3.csv' },
  { dataset: 'shipments', name: 'laheeb-filled-shipments-v3.csv' },
  { dataset: 'batches', name: 'laheeb-filled-batches-v3.csv' },
];

async function run(dryRun: boolean, userId: string | null = null): Promise<IngestSummary[]> {
  const summaries: IngestSummary[] = [];
  for (const file of files) {
    const text = await fs.readFile(path.join(validatedPackageDir, file.name), 'utf8');
    const summary = await ingestCsv(file.dataset, text, {
      userId,
      branchId: null,
      fileName: file.name,
      dryRun,
    });
    summaries.push(summary);
    if (summary.errors.length) {
      throw new Error(`${file.dataset}: ${summary.errors.map((error) => error.message).join('; ')}`);
    }
  }
  return summaries;
}

async function main(): Promise<void> {
const dryRun: IngestSummary[] = [];
let firstImport: IngestSummary[] | undefined;
let secondImport: IngestSummary[] | undefined;
if (apply) {
  const actor = await prisma.user.findFirst({
    where: { isActive: true, role: { in: ['OWNER', 'ADMIN'] } },
    orderBy: { role: 'asc' },
    select: { id: true },
  });
  if (!actor) throw new Error('Preview import requires an active Owner or Admin for audit attribution');
  firstImport = [];
  for (const file of files) {
    const text = await fs.readFile(path.join(validatedPackageDir, file.name), 'utf8');
    const validation = await ingestCsv(file.dataset, text, {
      userId: actor.id,
      branchId: null,
      fileName: file.name,
      dryRun: true,
    });
    dryRun.push(validation);
    if (validation.errors.length) {
      throw new Error(`${file.dataset}: ${validation.errors.map((error) => error.message).join('; ')}`);
    }
    const imported = await ingestCsv(file.dataset, text, {
      userId: actor.id,
      branchId: null,
      fileName: file.name,
      dryRun: false,
    });
    firstImport.push(imported);
    if (imported.errors.length) {
      throw new Error(`${file.dataset}: ${imported.errors.map((error) => error.message).join('; ')}`);
    }
  }
  secondImport = await run(false, actor.id);
} else {
  dryRun.push(...await run(true));
}

const checks: { name: string; actual: number; expected: number }[] = [];
if (apply) {
  const roles = await prisma.listOption.findMany({ where: { listKey: 'orderStatus' }, select: { code: true, metricRole: true } });
  const saleStatuses = roles.filter((role) => role.metricRole === 'SALE').map((role) => role.code);
  if (!saleStatuses.length) saleStatuses.push('COMPLETED');
  const [customers, orderLines, orders, completed, pending, shipments, batches] = await Promise.all([
    prisma.customer.count(),
    prisma.orderLine.count(),
    prisma.order.count(),
    prisma.order.count({ where: { status: { in: saleStatuses } } }),
    prisma.order.count({ where: { status: 'PENDING' } }),
    prisma.shipment.count(),
    prisma.roastBatch.count(),
  ]);
  checks.push(
    { name: 'customers', actual: customers, expected: 68 },
    { name: 'order lines', actual: orderLines, expected: 160 },
    { name: 'orders', actual: orders, expected: 75 },
    { name: 'completed orders', actual: completed, expected: 68 },
    { name: 'pending orders', actual: pending, expected: 7 },
    { name: 'shipments', actual: shipments, expected: 63 },
    { name: 'batches', actual: batches, expected: 4 },
  );

  const finance = await prisma.financeEntry.findMany({
    where: { archivedAt: null, reversedAt: null, reversalOfId: null },
    select: {
      amount: true,
      obligationKind: true,
      categoryType: true,
      party: { select: { externalKey: true } },
      account: { select: { externalKey: true } },
      orderId: true,
    },
  });
  const sum = (predicate: (row: typeof finance[number]) => boolean) => finance.filter(predicate).reduce((total, row) => total + row.amount, 0);
  checks.push(
    { name: 'walk-in cash', actual: sum((row) => row.account?.externalKey === 'CASH_ON_HANDS' && Boolean(row.orderId)), expected: 55_500 },
    { name: 'Hi-Express receivable', actual: sum((row) => row.party?.externalKey === 'HI_EXPRESS' && row.obligationKind === 'RECEIVABLE'), expected: 1_177_000 },
    { name: 'Wayl receivable', actual: sum((row) => row.party?.externalKey === 'WAYL' && row.obligationKind === 'RECEIVABLE'), expected: 172_500 },
    { name: 'delivery payable', actual: sum((row) => row.party?.externalKey === 'HI_EXPRESS' && row.obligationKind === 'PAYABLE' && row.categoryType === 'SHIPPING'), expected: 280_000 },
  );

  const inventory = await prisma.inventoryItem.findMany({
    where: { externalKey: { in: ['GREEN_GUJI', 'GREEN_ROBUSTA', 'GREEN_LEKEMPTI', 'GREEN_MINAS'] } },
    select: { externalKey: true, movements: { select: { quantity: true } } },
  });
  const expectedInventory: Record<string, number> = {
    GREEN_GUJI: 8.150,
    GREEN_ROBUSTA: 25.630,
    GREEN_LEKEMPTI: 22.340,
    GREEN_MINAS: 15.280,
  };
  for (const item of inventory) {
    if (!item.externalKey) continue;
    checks.push({
      name: item.externalKey,
      actual: item.movements.reduce((total, movement) => total + Number(movement.quantity), 0),
      expected: expectedInventory[item.externalKey],
    });
  }
}

const failures = checks.filter((check) => Math.abs(check.actual - check.expected) > 0.000_5);
console.log(JSON.stringify({ dryRun, firstImport, secondImport, checks, failures }, null, 2));
await prisma.$disconnect();
if (failures.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
