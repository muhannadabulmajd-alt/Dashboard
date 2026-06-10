'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db/client';
import { requireCap, audit, reqField, optField, type ActionState } from '@/server/records/shared';

const LIST = '/[locale]/(dashboard)/admin/branches';
const CAP = 'manage:branches' as const;

const schema = z.object({
  code: z.string().min(2),
  nameEn: z.string().min(2),
  nameAr: z.string().min(2),
  branchType: z.enum(['HQ', 'COMPANY', 'FRANCHISE']),
  governorate: z.string().min(1), // list-managed code (§9)
  city: z.string().optional(),
  address: z.string().optional(),
  street: z.string().optional(),
  notes: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  managerName: z.string().optional(),
  managerPhone: z.string().optional(),
  managerEmail: z.string().optional(),
  franchiseeName: z.string().optional(),
  franchiseePhone: z.string().optional(),
  franchiseeEmail: z.string().optional(),
  agreementStart: z.coerce.date().optional(),
  agreementEnd: z.coerce.date().optional(),
  openingDate: z.coerce.date().optional(),
  operatingHours: z.string().optional(),
  hasDelivery: z.boolean(),
  hasPos: z.boolean(),
  trackInventory: z.boolean(),
  hasWarehouse: z.boolean(),
});

function parse(fd: FormData) {
  return schema.safeParse({
    code: reqField(fd, 'code'),
    nameEn: reqField(fd, 'nameEn'),
    nameAr: reqField(fd, 'nameAr'),
    branchType: reqField(fd, 'branchType'),
    governorate: reqField(fd, 'governorate'),
    city: optField(fd, 'city'),
    address: optField(fd, 'address'),
    street: optField(fd, 'street'),
    notes: optField(fd, 'notes'),
    phone: optField(fd, 'phone'),
    email: optField(fd, 'email'),
    managerName: optField(fd, 'managerName'),
    managerPhone: optField(fd, 'managerPhone'),
    managerEmail: optField(fd, 'managerEmail'),
    franchiseeName: optField(fd, 'franchiseeName'),
    franchiseePhone: optField(fd, 'franchiseePhone'),
    franchiseeEmail: optField(fd, 'franchiseeEmail'),
    agreementStart: optField(fd, 'agreementStart'),
    agreementEnd: optField(fd, 'agreementEnd'),
    openingDate: optField(fd, 'openingDate'),
    operatingHours: optField(fd, 'operatingHours'),
    hasDelivery: fd.get('hasDelivery') != null,
    hasPos: fd.get('hasPos') != null,
    trackInventory: fd.get('trackInventory') != null,
    hasWarehouse: fd.get('hasWarehouse') != null,
  });
}

type Parsed = z.infer<typeof schema>;

/** Map parsed form → Prisma data: normalize blanks to null, sync isFranchise,
 * and clear franchise-only fields when the branch isn't a franchise. */
function toData(d: Parsed) {
  const isFranchise = d.branchType === 'FRANCHISE';
  const n = (v?: string) => v || null;
  return {
    nameEn: d.nameEn,
    nameAr: d.nameAr,
    branchType: d.branchType,
    isFranchise,
    governorate: d.governorate,
    city: n(d.city),
    address: n(d.address),
    street: n(d.street),
    notes: n(d.notes),
    phone: n(d.phone),
    email: n(d.email),
    managerName: n(d.managerName),
    managerPhone: n(d.managerPhone),
    managerEmail: n(d.managerEmail),
    franchiseeName: isFranchise ? n(d.franchiseeName) : null,
    franchiseePhone: isFranchise ? n(d.franchiseePhone) : null,
    franchiseeEmail: isFranchise ? n(d.franchiseeEmail) : null,
    agreementStart: isFranchise ? (d.agreementStart ?? null) : null,
    agreementEnd: isFranchise ? (d.agreementEnd ?? null) : null,
    openingDate: d.openingDate ?? null,
    operatingHours: n(d.operatingHours),
    hasDelivery: d.hasDelivery,
    hasPos: d.hasPos,
    trackInventory: d.trackInventory,
    hasWarehouse: d.hasWarehouse,
  };
}

export async function createBranch(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  const code = r.data.code.toUpperCase();
  if (await prisma.branch.findUnique({ where: { code }, select: { id: true } })) return { error: 'exists' };
  const branch = await prisma.branch.create({ data: { ...toData(r.data), code } });
  await audit(user.id, 'CREATE', 'Branch', { id: branch.id, code });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/branches/${branch.id}`);
}

export async function updateBranch(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireCap(CAP);
  if (!user) return { error: 'forbidden' };
  const r = parse(fd);
  if (!r.success) return { error: 'invalid' };
  const locale = reqField(fd, 'locale') || 'ar';
  // code is the permanent key — immutable after creation (§14).
  await prisma.branch.update({ where: { id }, data: toData(r.data) });
  await audit(user.id, 'UPDATE', 'Branch', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/branches/${id}`);
}

export async function archiveBranch(id: string, locale: string, active: boolean): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  await prisma.branch.update({ where: { id }, data: { isActive: active } });
  await audit(user.id, active ? 'RESTORE' : 'ARCHIVE', 'Branch', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/branches/${id}`);
}

/** Branches with linked records are archived, not deleted, to preserve history
 * (§14). Only an unused branch is hard-deleted. */
export async function deleteBranch(id: string, locale: string): Promise<void> {
  const user = await requireCap(CAP);
  if (!user) return;
  const counts = await prisma.$transaction([
    prisma.user.count({ where: { branchId: id } }),
    prisma.order.count({ where: { branchId: id } }),
    prisma.inventoryItem.count({ where: { branchId: id } }),
    prisma.expense.count({ where: { branchId: id } }),
  ]);
  const inUse = counts.some((c) => c > 0);
  if (inUse) {
    await prisma.branch.update({ where: { id }, data: { isActive: false } });
    await audit(user.id, 'ARCHIVE', 'Branch', { id, reason: 'in-use' });
    revalidatePath(LIST, 'page');
    redirect(`/${locale}/admin/branches/${id}`);
  }
  await prisma.branch.delete({ where: { id } });
  await audit(user.id, 'DELETE', 'Branch', { id });
  revalidatePath(LIST, 'page');
  redirect(`/${locale}/admin/branches`);
}
