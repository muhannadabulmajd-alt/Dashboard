'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/server/auth/session';
import { can } from '@/lib/rbac';
import { runConnectorSync } from './sync';

/** Trigger a manual sync from the admin connectors page (bound to a connector). */
export async function syncConnector(connectorId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'manage:connectors')) return;
  await runConnectorSync(connectorId);
  revalidatePath('/[locale]/(dashboard)/admin/connectors', 'page');
}
