'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentUser } from '@/server/auth/session';
import { can } from '@/lib/rbac';
import { GOVERNORATES } from '@/lib/enums';
import { prisma } from '@/server/db/client';

export type CreateBranchState = { error?: string; ok?: boolean } | undefined;

const schema = z.object({
  code: z.string().min(2),
  nameEn: z.string().min(2),
  nameAr: z.string().min(2),
  governorate: z.enum(GOVERNORATES),
  isFranchise: z.boolean(),
});

export async function createBranch(
  _prev: CreateBranchState,
  formData: FormData,
): Promise<CreateBranchState> {
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'manage:branches')) return { error: 'forbidden' };

  const parsed = schema.safeParse({
    code: formData.get('code'),
    nameEn: formData.get('nameEn'),
    nameAr: formData.get('nameAr'),
    governorate: formData.get('governorate'),
    isFranchise: formData.get('isFranchise') === 'on',
  });
  if (!parsed.success) return { error: 'invalid' };

  const code = parsed.data.code.toUpperCase();
  const exists = await prisma.branch.findUnique({ where: { code } });
  if (exists) return { error: 'exists' };

  await prisma.branch.create({ data: { ...parsed.data, code } });
  await prisma.auditLog.create({
    data: { userId: user.id, action: 'CREATE_BRANCH', entity: 'Branch', metadata: { code } },
  });

  revalidatePath('/[locale]/(dashboard)/admin/branches', 'page');
  return { ok: true };
}
