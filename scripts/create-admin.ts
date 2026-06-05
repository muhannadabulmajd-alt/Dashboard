/**
 * Bootstrap (or reset) a single OWNER account without touching any other data —
 * the production-safe alternative to `db:seed` (which wipes the database for the
 * demo dataset). There is no public sign-up, so this is how you create the first
 * admin after deploying.
 *
 *   ADMIN_EMAIL=you@laheeb.coffee ADMIN_PASSWORD='a-strong-password' pnpm create-admin
 *   # or: pnpm create-admin you@laheeb.coffee 'a-strong-password' "Your Name"
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL || process.argv[2] || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || process.argv[3] || '';
  const name = process.env.ADMIN_NAME || process.argv[4] || 'Owner';

  if (!email || !password) {
    console.error('Usage: ADMIN_EMAIL=.. ADMIN_PASSWORD=.. pnpm create-admin');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  // Ensure at least one branch exists so the owner has a home branch.
  let branch = await prisma.branch.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!branch) {
    branch = await prisma.branch.create({
      data: { code: 'HQ', nameEn: 'Headquarters', nameAr: 'المقر الرئيسي', governorate: 'BAGHDAD' },
    });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { hashedPassword, role: 'OWNER', isActive: true, name },
    create: { email, name, role: 'OWNER', hashedPassword, isActive: true, branchId: branch.id },
  });

  console.log(`✅ Owner ready: ${user.email} (role OWNER). Sign in and create the rest of your users from /admin/users.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
