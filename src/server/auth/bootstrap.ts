import 'server-only';
import bcrypt from 'bcryptjs';
import { prisma } from '@/server/db/client';

/**
 * First-run admin bootstrap (no terminal needed). On a brand-new deployment with
 * an empty users table, signing in with the ADMIN_EMAIL / ADMIN_PASSWORD set in
 * the hosting env creates the OWNER account (and an HQ branch). After the first
 * user exists this never does anything, so it is safe to leave enabled.
 */
export async function maybeBootstrapOwner(email: string, password: string): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) return;
  if (email.trim().toLowerCase() !== adminEmail || password !== adminPassword) return;

  // Only ever bootstrap into an empty system.
  if ((await prisma.user.count()) > 0) return;

  let branch = await prisma.branch.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!branch) {
    branch = await prisma.branch.create({
      data: { code: 'HQ', nameEn: 'Headquarters', nameAr: 'المقر الرئيسي', governorate: 'BAGHDAD' },
    });
  }
  await prisma.user.create({
    data: {
      email: adminEmail,
      name: process.env.ADMIN_NAME || 'Owner',
      role: 'OWNER',
      isActive: true,
      hashedPassword: bcrypt.hashSync(adminPassword, 10),
      branchId: branch.id,
    },
  });
}
