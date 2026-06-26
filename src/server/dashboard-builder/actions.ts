'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getCurrentUser } from '@/server/auth/session';
import { DashboardConfigSchema } from '@/lib/dashboard-builder';
import {
  createDashboardFromTemplate,
  deleteDashboard,
  duplicateDashboard,
  updateDashboard,
  type BuilderUser,
} from './service';

function builderUser(user: Awaited<ReturnType<typeof getCurrentUser>>): BuilderUser | null {
  return user ? { id: user.id, role: user.role, branchId: user.branchId } : null;
}

function requiredText(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  templateKey: z.string().optional(),
  locale: z.string().default('ar'),
});

export async function createDashboardAction(fd: FormData): Promise<void> {
  const user = builderUser(await getCurrentUser());
  if (!user) redirect('/ar/login');
  const parsed = createSchema.safeParse({
    name: requiredText(fd, 'name'),
    description: requiredText(fd, 'description') || undefined,
    templateKey: requiredText(fd, 'templateKey') || undefined,
    locale: requiredText(fd, 'locale') || 'ar',
  });
  if (!parsed.success) redirect(`/${requiredText(fd, 'locale') || 'ar'}/dashboard-builder`);
  const id = await createDashboardFromTemplate(user, parsed.data);
  revalidatePath('/[locale]/(dashboard)/dashboard-builder', 'page');
  redirect(`/${parsed.data.locale}/dashboard-builder/${id}`);
}

export async function duplicateDashboardAction(id: string, locale: string): Promise<void> {
  const user = builderUser(await getCurrentUser());
  if (!user) redirect(`/${locale}/login`);
  const copyId = await duplicateDashboard(user, id);
  revalidatePath('/[locale]/(dashboard)/dashboard-builder', 'page');
  redirect(`/${locale}/dashboard-builder/${copyId}`);
}

export async function deleteDashboardAction(id: string, locale: string): Promise<void> {
  const user = builderUser(await getCurrentUser());
  if (!user) redirect(`/${locale}/login`);
  await deleteDashboard(user, id);
  revalidatePath('/[locale]/(dashboard)/dashboard-builder', 'page');
  redirect(`/${locale}/dashboard-builder`);
}

export async function saveDashboardConfigAction(id: string, configJson: string, commit: boolean): Promise<{ ok: true } | { error: string }> {
  const user = builderUser(await getCurrentUser());
  if (!user) return { error: 'forbidden' };
  const raw = JSON.parse(configJson) as unknown;
  const config = DashboardConfigSchema.parse(raw);
  await updateDashboard(user, id, { config, saveDraftOnly: !commit });
  revalidatePath('/[locale]/(dashboard)/dashboard-builder/[id]', 'page');
  return { ok: true };
}

export async function updateDashboardMetaAction(id: string, fd: FormData): Promise<void> {
  const user = builderUser(await getCurrentUser());
  const locale = requiredText(fd, 'locale') || 'ar';
  if (!user) redirect(`/${locale}/login`);
  await updateDashboard(user, id, {
    name: requiredText(fd, 'name'),
    description: requiredText(fd, 'description'),
    visibility: requiredText(fd, 'visibility') === 'SHARED' ? 'SHARED' : 'PRIVATE',
    isPinned: fd.get('isPinned') === 'on',
  });
  revalidatePath('/[locale]/(dashboard)/dashboard-builder/[id]', 'page');
  redirect(`/${locale}/dashboard-builder/${id}`);
}
