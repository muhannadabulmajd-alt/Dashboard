import 'server-only';
import { getCurrentUser } from '@/server/auth/session';
import { can, type Capability } from '@/lib/rbac';
import { prisma } from '@/server/db/client';
import type { Prisma } from '@prisma/client';

/** Result returned by create/update record actions (drives useActionState UIs). */
export type ActionState = { ok?: boolean; error?: string } | undefined;

/** Return the current user iff they hold the capability, else null. */
export async function requireCap(capability: Capability) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, capability)) return null;
  return user;
}

export async function audit(
  userId: string | null,
  action: string,
  entity: string,
  metadata: Prisma.InputJsonValue,
) {
  await prisma.auditLog.create({ data: { userId, action, entity, metadata } });
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v.trim() : '';
};
/** Trimmed string or undefined when blank. */
export const optField = (fd: FormData, k: string) => str(fd, k) || undefined;
export const reqField = str;
