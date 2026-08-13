import 'server-only';
import { cache } from 'react';
import type { Role } from '@prisma/client';
import { prisma } from '@/server/db/client';
import { auth } from './config';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  branchId: string | null;
}

/** Resolve the authenticated user and refresh mutable authorization state. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      branchId: true,
      isActive: true,
    },
  });
  if (!user?.isActive) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    branchId: user.branchId,
  };
});
