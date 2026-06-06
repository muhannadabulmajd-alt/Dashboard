import 'server-only';
import bcrypt from 'bcryptjs';
import { prisma } from '@/server/db/client';

/**
 * Env-driven owner account (no terminal needed).
 *
 * Signing in with the ADMIN_EMAIL / ADMIN_PASSWORD configured in the hosting
 * environment guarantees an active OWNER account with that password:
 *   - first run (no such user yet): creates the OWNER (and an HQ branch);
 *   - afterwards: if that same email already exists, its password is reset to
 *     ADMIN_PASSWORD — so this doubles as a no-terminal password reset.
 *
 * It only ever runs when the typed credentials exactly match the env values, so
 * it is gated by knowledge of the secret ADMIN_PASSWORD. Once you are set up you
 * can remove ADMIN_PASSWORD from the environment to disable it entirely.
 *
 * Env values are trimmed so a stray space/newline accidentally pasted into the
 * hosting dashboard does not silently block sign-in.
 */
export async function maybeBootstrapOwner(email: string, password: string): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD?.trim();
  if (!adminEmail || !adminPassword) return;
  if (email.trim().toLowerCase() !== adminEmail || password !== adminPassword) return;

  // Account already present: ensure it is active and its password matches the
  // configured ADMIN_PASSWORD (acts as a recovery / reset path). Avoid a needless
  // write when the stored password is already correct.
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existing) {
    const alreadyOk =
      existing.isActive && (await bcrypt.compare(adminPassword, existing.hashedPassword));
    if (!alreadyOk) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { hashedPassword: bcrypt.hashSync(adminPassword, 10), isActive: true },
      });
    }
    return;
  }

  // First run: create the owner and an HQ branch to attach them to.
  let branch = await prisma.branch.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!branch) {
    branch = await prisma.branch.create({
      data: { code: 'HQ', nameEn: 'Headquarters', nameAr: 'المقر الرئيسي', governorate: 'BAGHDAD' },
    });
  }
  await prisma.user.create({
    data: {
      email: adminEmail,
      name: process.env.ADMIN_NAME?.trim() || 'Owner',
      role: 'OWNER',
      isActive: true,
      hashedPassword: bcrypt.hashSync(adminPassword, 10),
      branchId: branch.id,
    },
  });
}
