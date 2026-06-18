'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db/client';
import { requireCap, audit, reqField, optField } from '@/server/records/shared';
import { LIST_BY_KEY, canAddValues, type ListDef } from './registry';
import { getListEntries } from './resolver';

const PAGE = '/[locale]/(dashboard)/admin/records/system-lists';
const CAP = 'manage:lists' as const;

function back(locale: string, key: string): never {
  revalidatePath(PAGE, 'page');
  redirect(`/${locale}/admin/records/system-lists?list=${key}`);
}

// Dynamic delegate for usage counts / merges (model names match the registry).
const delegate = (model: string) =>
  (prisma as unknown as Record<string, { count: (a: unknown) => Promise<number>; updateMany: (a: unknown) => Promise<unknown> }>)[model];

async function usageCount(def: ListDef, code: string): Promise<number> {
  if (!def.usage) return 0;
  return delegate(def.usage.model).count({ where: { [def.usage.field]: code } });
}

const isBase = (def: ListDef, code: string) => def.base.includes(code);

/** Upsert an overlay row by (listKey, code), flagging system (base) codes. */
async function upsert(def: ListDef, code: string, data: { labelEn?: string; labelAr?: string; sortOrder?: number; isActive?: boolean; metricRole?: string | null }) {
  await prisma.listOption.upsert({
    where: { listKey_code: { listKey: def.key, code } },
    create: { listKey: def.key, code, labelEn: data.labelEn ?? code, labelAr: data.labelAr ?? code, metricRole: data.metricRole ?? null, sortOrder: data.sortOrder ?? 0, isActive: data.isActive ?? true, isSystem: isBase(def, code) },
    update: data,
  });
}

const slug = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'VALUE';

/** Add a new value to a list (only where new values are storable, §9). */
export async function createListValue(fd: FormData): Promise<void> {
  const user = await requireCap(CAP);
  const listKey = reqField(fd, 'listKey');
  const locale = reqField(fd, 'locale') || 'ar';
  const def = LIST_BY_KEY.get(listKey);
  if (!user || !def || !canAddValues(def)) return back(locale, listKey);
  const labelEn = reqField(fd, 'labelEn');
  if (!labelEn) return back(locale, listKey);
  const labelAr = reqField(fd, 'labelAr') || labelEn;
  const metricRole = listKey === 'orderStatus' && ['OPEN', 'SALE', 'RETURN', 'CANCELED'].includes(reqField(fd, 'metricRole'))
    ? reqField(fd, 'metricRole')
    : null;

  const entries = await getListEntries(listKey);
  const existing = new Set(entries.map((e) => e.code));
  // Soft lists store human-friendly codes (e.g. "TikTok"); enum lists use
  // UPPER_SNAKE codes to match the built-in convention.
  const raw = optField(fd, 'code') || labelEn;
  const baseCode = def.kind === 'soft' ? raw.trim() : slug(raw);
  let code = baseCode;
  for (let i = 2; existing.has(code); i++) code = def.kind === 'soft' ? `${baseCode} ${i}` : `${baseCode}_${i}`;
  const sortOrder = (entries.at(-1)?.sortOrder ?? entries.length) + 1;

  await prisma.listOption.create({ data: { listKey, code, labelEn, labelAr, metricRole, sortOrder, isActive: true, isSystem: false } });
  await audit(user.id, 'CREATE', 'ListOption', { listKey, code });
  back(locale, listKey);
}

/** Rename a value's EN/AR labels (allowed for system + added values). */
export async function saveListLabels(fd: FormData): Promise<void> {
  const user = await requireCap(CAP);
  const listKey = reqField(fd, 'listKey');
  const code = reqField(fd, 'code');
  const locale = reqField(fd, 'locale') || 'ar';
  const def = LIST_BY_KEY.get(listKey);
  if (!user || !def) return back(locale, listKey);
  const labelEn = reqField(fd, 'labelEn');
  if (!labelEn) return back(locale, listKey);
  let metricRole = listKey === 'orderStatus' && ['OPEN', 'SALE', 'RETURN', 'CANCELED'].includes(reqField(fd, 'metricRole'))
    ? reqField(fd, 'metricRole')
    : null;
  if (listKey === 'orderStatus' && (await usageCount(def, code)) > 0) {
    const current = (await getListEntries(listKey)).find((entry) => entry.code === code);
    metricRole = current?.metricRole ?? metricRole;
  }
  await upsert(def, code, { labelEn, labelAr: reqField(fd, 'labelAr') || labelEn, ...(listKey === 'orderStatus' ? { metricRole } : {}) });
  await audit(user.id, 'UPDATE', 'ListOption', { listKey, code, source: 'label' });
  back(locale, listKey);
}

export async function toggleListActive(listKey: string, code: string, active: boolean, locale: string): Promise<void> {
  const user = await requireCap(CAP);
  const def = LIST_BY_KEY.get(listKey);
  if (!user || !def) return back(locale, listKey);
  await upsert(def, code, { isActive: active });
  await audit(user.id, active ? 'RESTORE' : 'ARCHIVE', 'ListOption', { listKey, code });
  back(locale, listKey);
}

/** Move a value up/down by reindexing the list with the two positions swapped. */
export async function moveListValue(listKey: string, code: string, dir: 'up' | 'down', locale: string): Promise<void> {
  const user = await requireCap(CAP);
  const def = LIST_BY_KEY.get(listKey);
  if (!user || !def) return back(locale, listKey);
  const entries = await getListEntries(listKey);
  const i = entries.findIndex((e) => e.code === code);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= entries.length) return back(locale, listKey);
  const order = entries.map((e) => e.code);
  [order[i], order[j]] = [order[j], order[i]];
  for (let k = 0; k < order.length; k++) await upsert(def, order[k], { sortOrder: k });
  await audit(user.id, 'UPDATE', 'ListOption', { listKey, code, source: 'reorder' });
  back(locale, listKey);
}

/** Delete an added value; system values and in-use values are retired instead. */
export async function deleteListValue(listKey: string, code: string, locale: string): Promise<void> {
  const user = await requireCap(CAP);
  const def = LIST_BY_KEY.get(listKey);
  if (!user || !def || isBase(def, code)) return back(locale, listKey);
  if ((await usageCount(def, code)) > 0) {
    await upsert(def, code, { isActive: false });
    await audit(user.id, 'ARCHIVE', 'ListOption', { listKey, code, reason: 'in-use' });
    return back(locale, listKey);
  }
  await prisma.listOption.deleteMany({ where: { listKey, code } });
  await audit(user.id, 'DELETE', 'ListOption', { listKey, code });
  back(locale, listKey);
}

/** Merge one value into another: repoint records, then retire the source. */
export async function mergeListValue(fd: FormData): Promise<void> {
  const user = await requireCap(CAP);
  const listKey = reqField(fd, 'listKey');
  const locale = reqField(fd, 'locale') || 'ar';
  const def = LIST_BY_KEY.get(listKey);
  if (!user || !def) return back(locale, listKey);
  const from = reqField(fd, 'from');
  const to = reqField(fd, 'to');
  if (!from || !to || from === to) return back(locale, listKey);
  if (listKey === 'orderStatus') {
    const entries = await getListEntries(listKey);
    const fromRole = entries.find((entry) => entry.code === from)?.metricRole;
    const toRole = entries.find((entry) => entry.code === to)?.metricRole;
    if (fromRole !== toRole) return back(locale, listKey);
  }
  if (def.usage) await delegate(def.usage.model).updateMany({ where: { [def.usage.field]: from }, data: { [def.usage.field]: to } });
  if (isBase(def, from)) await upsert(def, from, { isActive: false });
  else await prisma.listOption.deleteMany({ where: { listKey, code: from } });
  await audit(user.id, 'MERGE', 'ListOption', { listKey, from, to });
  back(locale, listKey);
}
