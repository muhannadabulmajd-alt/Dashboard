import 'server-only';
import { cache } from 'react';
import type { Role } from '@prisma/client';
import { auth } from './config';

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  branchId: string | null;
}

/** Resolve the authenticated user from the JWT session (request-cached). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? '',
    name: session.user.name ?? '',
    role: session.user.role,
    branchId: session.user.branchId ?? null,
  };
});
