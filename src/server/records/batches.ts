'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { requireCap, audit, reqField, optField, type ActionState } from './shared';

const LIST = '/[locale]/(dashboard)/admin/records/batches';
const CAP = 'manage:batches' as const;

const schema = z.object({
  batchNumber: z.string().min(1),
  origin: z.string().min(1),
  roastDate: z.coerce.date().optional(),
  roastLevel: z.string().optional(), // list-managed code (§9)
  greenInputGrams: z.coerce.number().int().positive(),
  roastedOutputGrams: z.coerce.number().int().positive().optional(),
  qcScore: z.coerce.number().optional(),
  qcNotes: z.string().optional(),
});

function parse(fd: FormData) {
  return schema.safeParse({
    batchNumber: reqField(fd, 'batchNumber'),
    origin: reqField(fd, 'origin'),
    roastDate: optField(fd, 'roastDate'),
    roastLevel: optField(fd, 'roastLevel'),
    greenInputGrams: reqField(fd, 'greenInputGrams'),
    roastedOutputGrams: optField(fd, 'roastedOutputGrams'),
    qcScore: optField(fd, 'qcScore'),
    qcNotes: optField(fd, 'qcNotes'),
  });
}

export async function createBatch(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  if (await prisma.roastBatch.findUnique({ where: { batchNumber: r.data.batchNumber }, select: { id: true } }))
    return { error: 'exists' };
  const b = await prisma.roastBatch.create({ data: r.data });
  await audit(user.id, 'CREATE', 'RoastBatch', { batchNumber: r.data.batchNumber });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/batches/${b.id}`);
}

export async function updateBatch(
  id: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  // Batch number is the permanent key — immutable after creation (CR-5).
  const { batchNumber, ...data } = r.data;
  void batchNumber;
  await prisma.roastBatch.update({ where: { id }, data });
  await audit(user.id, 'UPDATE', 'RoastBatch', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/batches/${id}`);
}

export async function archiveBatch(id: string, locale: string, active: boolean): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  await prisma.roastBatch.update({ where: { id }, data: { isActive: active } });
  await audit(user.id, active ? 'RESTORE' : 'ARCHIVE', 'RoastBatch', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/batches/${id}`);
}

export async function deleteBatch(id: string, locale: string): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  try {
    await prisma.roastBatch.delete({ where: { id } });
    await audit(user.id, 'DELETE', 'RoastBatch', { id });
  } catch {
    // Referenced by SKU links — archive instead of hard delete.
    await prisma.roastBatch.update({ where: { id }, data: { isActive: false } });
    await audit(user.id, 'ARCHIVE', 'RoastBatch', { id, reason: 'in-use' });
  }
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/records/batches`);
}
