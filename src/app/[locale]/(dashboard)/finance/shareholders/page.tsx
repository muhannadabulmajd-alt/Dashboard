import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { formatMoney } from '@/lib/money';
import { PageHeader } from '@/components/ui/primitives';
import { KpiCard } from '@/components/kpi/KpiCard';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';

export default async function ShareholdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'view:finance');
  const t = await getTranslations('finance');

  const [shareholders, capEntries, expenseEntries] = await Promise.all([
    prisma.party.findMany({ where: { type: 'SHAREHOLDER' }, orderBy: { name: 'asc' } }),
    prisma.financeEntry.findMany({ where: { type: 'CAPITAL_IN', currency: 'IQD', reversedAt: null, reversalOfId: null }, select: { partyId: true, amount: true } }),
    prisma.financeEntry.findMany({ where: { type: { in: ['EXPENSE', 'PURCHASE'] }, currency: 'IQD', reversedAt: null, reversalOfId: null }, select: { amount: true } }),
  ]);

  const totalCapital = capEntries.reduce((s, e) => s + e.amount, 0);
  const totalSpent = expenseEntries.reduce((s, e) => s + e.amount, 0);
  const remaining = totalCapital - totalSpent;

  const byParty = new Map<string, { total: number; count: number }>();
  for (const e of capEntries) {
    if (!e.partyId) continue;
    const cur = byParty.get(e.partyId) ?? { total: 0, count: 0 };
    cur.total += e.amount;
    cur.count += 1;
    byParty.set(e.partyId, cur);
  }

  const cols: Column[] = [
    { label: t('f.name') },
    { label: t('contributions'), align: 'end' },
    { label: t('capital'), align: 'end' },
    { label: t('f.equityShare'), align: 'end' },
  ];
  const rows = shareholders.map((s) => {
    const agg = byParty.get(s.id) ?? { total: 0, count: 0 };
    const pct = s.equityShare ?? (totalCapital > 0 ? (agg.total / totalCapital) * 100 : 0);
    return [
      s.name,
      String(agg.count),
      formatMoney(agg.total, 'IQD', locale),
      `${pct.toFixed(1)}%`,
    ];
  });

  return (
    <>
      <BackLink href="/finance" label={t('shareholders')} />
      <PageHeader title={t('shareholders')} subtitle={t('subtitle')} />
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard locale={locale} label={t('totalCapital')} value={formatMoney(totalCapital, 'IQD', locale)} />
        <KpiCard locale={locale} label={t('spent')} value={formatMoney(totalSpent, 'IQD', locale)} />
        <KpiCard locale={locale} label={t('remaining')} value={formatMoney(remaining, 'IQD', locale)} />
      </div>
      <DataTable columns={cols} rows={rows} emptyLabel="—" />
    </>
  );
}
