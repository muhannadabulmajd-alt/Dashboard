import { getTranslations } from 'next-intl/server';
import { ArrowUp, ArrowDown, Plus } from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { can } from '@/lib/rbac';
import { PageHeader, Badge } from '@/components/ui/primitives';
import { BackLink } from '@/components/records/parts';
import { SectionGuide } from '@/components/records/SectionGuide';
import { ConfirmButton } from '@/components/records/RecordActions';
import { Link } from '@/i18n/navigation';
import { prisma } from '@/server/db/client';
import { LISTS, LIST_BY_KEY, canAddValues } from '@/server/lists/registry';
import { getListEntries } from '@/server/lists/resolver';
import { createListValue, saveListLabels, toggleListActive, moveListValue, deleteListValue, mergeListValue } from '@/server/lists/actions';

const input = 'w-full rounded-lg border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary';
const ctrlBtn = 'inline-flex items-center justify-center rounded-md border p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40';

async function usageCounts(model: string | undefined, field: string | undefined): Promise<Map<string, number>> {
  if (!model || !field) return new Map();
  const delegate = (prisma as unknown as Record<string, { groupBy: (a: unknown) => Promise<{ _count: { _all: number } }[]> }>)[model];
  try {
    const rows = (await delegate.groupBy({ by: [field], _count: { _all: true } })) as unknown as Record<string, unknown>[];
    return new Map(rows.map((r) => [String(r[field]), (r._count as { _all: number })._all]));
  } catch {
    return new Map();
  }
}

export default async function SystemListsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'view:records');
  const sp = await searchParams;
  const t = await getTranslations('records');
  const canManage = can(user.role, 'manage:lists');
  const selectedKey = typeof sp.list === 'string' && LIST_BY_KEY.has(sp.list) ? sp.list : LISTS[0].key;
  const def = LIST_BY_KEY.get(selectedKey)!;

  const [entries, usage] = await Promise.all([getListEntries(selectedKey), usageCounts(def.usage?.model, def.usage?.field)]);
  const allOpts = entries.map((e) => ({ value: e.code, label: locale === 'ar' ? e.labelAr : e.labelEn }));

  return (
    <>
      <BackLink href="/admin/records" label={t('back')} />
      <PageHeader title={t('lists.title')} subtitle={t('lists.subtitle')} />
      <SectionGuide title={t('guide.systemLists.title')} intro={t('guide.systemLists.intro')} points={t.raw('guide.systemLists.points') as string[]} />

      {/* List picker */}
      <div className="flex flex-wrap gap-1.5">
        {LISTS.map((l) => (
          <Link
            key={l.key}
            href={`/admin/records/system-lists?list=${l.key}`}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${l.key === selectedKey ? 'bg-primary text-primary-foreground' : 'border text-muted-foreground hover:bg-muted'}`}
          >
            {t(`lists.names.${l.key}`)}
          </Link>
        ))}
      </div>

      {!canManage ? <p className="text-xs text-muted-foreground">{t('lists.viewerNote')}</p> : null}
      {canManage && !canAddValues(def) ? <p className="text-xs text-muted-foreground">{t('lists.enumNote')}</p> : null}

      {/* Values */}
      <div className="space-y-2">
        {entries.map((e, i) => (
          <div key={e.code} className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border bg-card p-2.5">
            {canManage ? (
              <form action={saveListLabels} className="flex flex-1 flex-wrap items-center gap-2">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="listKey" value={selectedKey} />
                <input type="hidden" name="code" value={e.code} />
                <span className="w-28 shrink-0 truncate font-mono text-[11px] text-muted-foreground" title={e.code}>{e.code}</span>
                <input name="labelEn" defaultValue={e.labelEn} dir="ltr" className={`${input} max-w-[12rem]`} aria-label="EN" />
                <input name="labelAr" defaultValue={e.labelAr} dir="rtl" className={`${input} max-w-[12rem]`} aria-label="AR" />
                {selectedKey === 'orderStatus' ? (
                  <select name="metricRole" defaultValue={e.metricRole ?? 'OPEN'} className={`${input} max-w-[10rem]`} aria-label={t('lists.metricRole')}>
                    <option value="OPEN">{t('lists.metricRoles.OPEN')}</option>
                    <option value="SALE">{t('lists.metricRoles.SALE')}</option>
                    <option value="RETURN">{t('lists.metricRoles.RETURN')}</option>
                    <option value="CANCELED">{t('lists.metricRoles.CANCELED')}</option>
                  </select>
                ) : null}
                <button type="submit" className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">{t('save')}</button>
              </form>
            ) : (
              <span className="flex-1 text-sm">{locale === 'ar' ? e.labelAr : e.labelEn}</span>
            )}

            <span className="text-[11px] text-muted-foreground">{t('lists.used', { n: usage.get(e.code) ?? 0 })}</span>
            {e.isSystem ? <Badge variant="muted">{t('lists.system')}</Badge> : null}
            {!e.isActive ? <Badge variant="warning">{t('f.inactive')}</Badge> : null}

            {canManage ? (
              <div className="flex items-center gap-1">
                <form action={moveListValue.bind(null, selectedKey, e.code, 'up', locale)}>
                  <button className={ctrlBtn} disabled={i === 0} aria-label="up"><ArrowUp className="size-3.5" /></button>
                </form>
                <form action={moveListValue.bind(null, selectedKey, e.code, 'down', locale)}>
                  <button className={ctrlBtn} disabled={i === entries.length - 1} aria-label="down"><ArrowDown className="size-3.5" /></button>
                </form>
                <form action={toggleListActive.bind(null, selectedKey, e.code, !e.isActive, locale)}>
                  <button className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">{e.isActive ? t('archive') : t('restore')}</button>
                </form>
                {!e.isSystem ? (
                  <ConfirmButton action={deleteListValue.bind(null, selectedKey, e.code, locale)} label={t('delete')} confirm={t('confirmDelete')} />
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {canAddValues(def) ? (
            <form action={createListValue} className="space-y-2 rounded-[var(--radius)] border bg-card p-3">
              <h3 className="text-sm font-semibold">{t('lists.add')}</h3>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="listKey" value={selectedKey} />
              <div className="grid gap-2 sm:grid-cols-2">
                <input name="labelEn" required placeholder={t('lists.labelEn')} dir="ltr" className={input} />
                <input name="labelAr" placeholder={t('lists.labelAr')} dir="rtl" className={input} />
                {selectedKey === 'orderStatus' ? (
                  <select name="metricRole" defaultValue="OPEN" className={input} aria-label={t('lists.metricRole')}>
                    <option value="OPEN">{t('lists.metricRoles.OPEN')}</option>
                    <option value="SALE">{t('lists.metricRoles.SALE')}</option>
                    <option value="RETURN">{t('lists.metricRoles.RETURN')}</option>
                    <option value="CANCELED">{t('lists.metricRoles.CANCELED')}</option>
                  </select>
                ) : null}
              </div>
              <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-95">
                <Plus className="size-4" />{t('lists.add')}
              </button>
            </form>
          ) : null}

          <form action={mergeListValue} className="space-y-2 rounded-[var(--radius)] border bg-card p-3">
            <h3 className="text-sm font-semibold">{t('lists.merge')}</h3>
            <p className="text-xs text-muted-foreground">{t('lists.mergeHint')}</p>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="listKey" value={selectedKey} />
            <div className="grid gap-2 sm:grid-cols-2">
              <select name="from" className={input} aria-label={t('lists.mergeFrom')}>
                {allOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <select name="to" className={input} aria-label={t('lists.mergeTo')}>
                {allOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <button type="submit" className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted">{t('lists.mergeBtn')}</button>
          </form>
        </div>
      ) : null}
    </>
  );
}
