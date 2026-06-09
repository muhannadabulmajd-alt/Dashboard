import 'server-only';
import { cache } from 'react';
import { prisma } from '@/server/db/client';
import { ENUM_LABELS } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';
import { LIST_BY_KEY } from './registry';

export interface ListEntry {
  code: string;
  labelEn: string;
  labelAr: string;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
}

/** All overlay rows, grouped by listKey then code. Cached per request. */
const loadAll = cache(async () => {
  const rows = await prisma.listOption.findMany();
  const byKey = new Map<string, Map<string, (typeof rows)[number]>>();
  for (const r of rows) {
    if (!byKey.has(r.listKey)) byKey.set(r.listKey, new Map());
    byKey.get(r.listKey)!.set(r.code, r);
  }
  return byKey;
});

const staticLabel = (code: string): { en: string; ar: string } => ENUM_LABELS[code] ?? { en: code, ar: code };

/** Full merged entries for a list (base ∪ overlay) — for management + options. */
export async function getListEntries(key: string): Promise<ListEntry[]> {
  const def = LIST_BY_KEY.get(key);
  if (!def) return [];
  const overrides = (await loadAll()).get(key) ?? new Map();
  const out: ListEntry[] = [];
  const seen = new Set<string>();
  def.base.forEach((code, i) => {
    const o = overrides.get(code);
    const lbl = staticLabel(code);
    out.push({
      code,
      labelEn: o?.labelEn ?? lbl.en,
      labelAr: o?.labelAr ?? lbl.ar,
      sortOrder: o?.sortOrder ?? i,
      isActive: o?.isActive ?? true,
      isSystem: true,
    });
    seen.add(code);
  });
  for (const [code, o] of overrides) {
    if (seen.has(code)) continue; // user-added value
    out.push({ code, labelEn: o.labelEn, labelAr: o.labelAr, sortOrder: o.sortOrder, isActive: o.isActive, isSystem: false });
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.labelEn.localeCompare(b.labelEn));
}

/** Active {value,label} options for dropdowns/filters. */
export async function getListOptions(key: string, locale: AppLocale): Promise<{ value: string; label: string }[]> {
  const entries = await getListEntries(key);
  return entries.filter((e) => e.isActive).map((e) => ({ value: e.code, label: locale === 'ar' ? e.labelAr : e.labelEn }));
}

/** Label for one code (overlay → static → the code itself). */
export async function getListLabel(key: string, code: string | null | undefined, locale: AppLocale): Promise<string> {
  if (!code) return '—';
  const e = (await getListEntries(key)).find((x) => x.code === code);
  if (e) return locale === 'ar' ? e.labelAr : e.labelEn;
  const lbl = staticLabel(code);
  return locale === 'ar' ? lbl.ar : lbl.en;
}
