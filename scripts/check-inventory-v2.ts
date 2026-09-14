import { PrismaClient } from '@prisma/client';
import {
  inventoryPreflightPassed,
  runInventoryV2Preflight,
} from '../src/server/inventory-v2/preflight';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const findings = await runInventoryV2Preflight(prisma);

  for (const finding of findings) {
    const status = finding.count === 0 ? 'PASS' : finding.severity;
    console.log(`${status} ${finding.key}: ${finding.count}`);
    if (finding.count > 0) console.log(`  ${finding.message}`);
    if (finding.examples.length) console.log(`  Examples: ${finding.examples.join(', ')}`);
  }

  if (!inventoryPreflightPassed(findings)) {
    throw new Error('Inventory V2 preflight has blocking findings. No inventory data was changed.');
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Inventory V2 preflight failed.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
