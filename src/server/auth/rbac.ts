import 'server-only';
import { redirect } from 'next/navigation';
import { can, type Capability } from '@/lib/rbac';
import { getCurrentUser, type CurrentUser } from './session';

/** Require an authenticated user; redirect to the localized login otherwise. */
export async function requireUser(locale: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  return user;
}

/** Require a capability; redirect unauthorized users to the dashboard home. */
export async function requireCapability(
  locale: string,
  capability: Capability,
): Promise<CurrentUser> {
  const user = await requireUser(locale);
  if (!can(user.role, capability)) redirect(`/${locale}`);
  return user;
}
