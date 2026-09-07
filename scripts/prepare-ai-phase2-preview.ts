import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { AI_CAPABILITIES } from '../src/lib/ai-capabilities';

const prisma = new PrismaClient();
const E2E_EMAIL = 'ai-phase2-preview@laheeb.test';

function requireIsolatedPreview(): void {
  if (process.env.AI_PHASE2_DATABASE_ISOLATED !== 'true') {
    throw new Error('ai_phase2_preview_requires_isolated_database');
  }
  const databaseUrl = process.env.DATABASE_URL;
  const expectedHost = process.env.AI_PHASE2_EXPECTED_DB_HOST;
  if (!databaseUrl || !expectedHost) throw new Error('ai_phase2_preview_database_identity_missing');
  const actualHost = new URL(databaseUrl).hostname;
  if (actualHost !== expectedHost || !actualHost.endsWith('.neon.tech')) {
    throw new Error('ai_phase2_preview_database_identity_mismatch');
  }
}

async function main(): Promise<void> {
  requireIsolatedPreview();
  const password = process.env.AI_PHASE2_E2E_PASSWORD;
  if (!password || password.length < 24) throw new Error('ai_phase2_preview_password_invalid');

  const [branch, account, product] = await Promise.all([
    prisma.branch.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    }),
    prisma.financeAccount.findFirstOrThrow({
      where: { isActive: true, currency: 'IQD', type: { not: 'PAYMENT_GATEWAY' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    }),
    prisma.product.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { sku: 'asc' },
      select: { sku: true },
    }),
  ]);

  const hashedPassword = await bcrypt.hash(password, 10);
  await prisma.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { email: E2E_EMAIL },
      create: {
        email: E2E_EMAIL,
        name: 'AI Phase 2 Preview Owner',
        hashedPassword,
        role: 'OWNER',
        branchId: branch.id,
        defaultFinanceAccountId: account.id,
        isActive: true,
      },
      update: {
        name: 'AI Phase 2 Preview Owner',
        hashedPassword,
        role: 'OWNER',
        branchId: branch.id,
        defaultFinanceAccountId: account.id,
        isActive: true,
      },
    });
    for (const capability of AI_CAPABILITIES) {
      await tx.aiCapabilitySetting.upsert({
        where: { capability },
        create: { capability, status: 'ENABLED', failureCount: 0, failureLimit: 3 },
        update: {
          status: 'ENABLED',
          failureCount: 0,
          failureLimit: 3,
          disabledReason: null,
          lastFailureAt: null,
        },
      });
    }
  });

  process.stdout.write(JSON.stringify({ email: E2E_EMAIL, productSku: product.sku }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'ai_phase2_preview_fixture_failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
