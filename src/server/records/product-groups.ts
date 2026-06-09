'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { PRODUCT_LINES } from '@/lib/enums';
import { requireCap, audit, reqField, optField, type ActionState } from './shared';

const LIST = '/[locale]/(dashboard)/admin/records/product-groups';
const CAP = 'manage:products' as const;

const schema = z.object({
  nameEn: z.string().min(1),
  nameAr: z.string().min(1),
  productLine: z.enum(PRODUCT_LINES),
  productType: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().url().optional().or(z.literal('')),
});

function parse(fd: FormData) {
  return schema.safeParse({
    nameEn: reqField(fd, 'nameEn'),
    nameAr: reqField(fd, 'nameAr'),
    productLine: reqField(fd, 'productLine'),
    productType: optField(fd, 'productType'),
    description: optField(fd, 'description'),
    imageUrl: optField(fd, 'imageUrl'),
  });
}

// Normalize an empty image URL to null.
const clean = <T extends { imageUrl?: string }>(d: T) => ({ ...d, imageUrl: d.imageUrl || null });

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2002';

/** Next sequential, immutable group code, e.g. PG-000001. */
export async function nextGroupCode(): Promise<string> {
  const rows = await prisma.productGroup.findMany({ select: { code: true } });
  let max = 0;
  for (const { code } of rows) {
    const m = code.match(/^PG-0*(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `PG-${String(max + 1).padStart(6, '0')}`;
}

export async function createProductGroup(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  let created;
  for (let attempt = 0; ; attempt++) {
    const code = await nextGroupCode();
    try {
      created = await prisma.productGroup.create({ data: { ...clean(r.data), code } });
      break;
    } catch (e) {
      if (isUniqueViolation(e) && attempt < 5) continue; // race: regenerate
      throw e;
    }
  }
  await audit(user.id, 'CREATE', 'ProductGroup', { code: created.code });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/product-groups/${created.id}`);
}

export async function updateProductGroup(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  // `code` is immutable (BRD §10) — never updated.
  await prisma.productGroup.update({ where: { id }, data: clean(r.data) });
  await audit(user.id, 'UPDATE', 'ProductGroup', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/product-groups/${id}`);
}

export async function archiveProductGroup(id: string, locale: string, active: boolean): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  await prisma.productGroup.update({ where: { id }, data: { isActive: active } });
  await audit(user.id, active ? 'RESTORE' : 'ARCHIVE', 'ProductGroup', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/product-groups/${id}`);
}

export async function deleteProductGroup(id: string, locale: string): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  // Unlink variations first (products keep working standalone), then delete.
  await prisma.product.updateMany({ where: { groupId: id }, data: { groupId: null } });
  await prisma.productGroup.delete({ where: { id } });
  await audit(user.id, 'DELETE', 'ProductGroup', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/product-groups`);
}
