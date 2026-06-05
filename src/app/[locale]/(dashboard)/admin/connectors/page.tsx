import { getTranslations } from 'next-intl/server';
import { RefreshCw } from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { formatDate } from '@/lib/dates';
import { syncConnector } from '@/server/connectors/actions';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable } from '@/components/data-table/DataTable';

const RUN_VARIANT: Record<string, 'success' | 'warning' | 'danger'> = {
  SUCCESS: 'success',
  PARTIAL: 'warning',
  FAILED: 'danger',
};

export default async function ConnectorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:connectors');
  const t = await getTranslations('connectors');

  const [connectors, runs] = await Promise.all([
    prisma.connector.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.syncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 10,
      include: { connector: { select: { name: true } } },
    }),
  ]);

  const connectorCols = [
    { label: t('name') },
    { label: t('type') },
    { label: t('dataset') },
    { label: t('status') },
    { label: t('lastSync'), align: 'end' as const },
    { label: t('action'), align: 'end' as const },
  ];
  const connectorRows = connectors.map((c) => [
    c.name,
    c.type,
    c.dataset,
    <Badge key="s" variant={c.status === 'ACTIVE' ? 'success' : 'muted'}>
      {c.status === 'ACTIVE' ? t('active') : t('paused')}
    </Badge>,
    c.lastSyncAt ? formatDate(c.lastSyncAt, locale) : t('never'),
    c.status === 'ACTIVE' ? (
      <form key="f" action={syncConnector.bind(null, c.id)} className="flex justify-end">
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs font-medium hover:bg-muted"
        >
          <RefreshCw className="size-3.5" />
          {t('syncNow')}
        </button>
      </form>
    ) : (
      '—'
    ),
  ]);

  const runCols = [
    { label: t('name') },
    { label: t('result') },
    { label: t('rows'), align: 'end' as const },
    { label: t('when'), align: 'end' as const },
    { label: t('message') },
  ];
  const runRows = runs.map((r) => [
    r.connector.name,
    <Badge key="s" variant={RUN_VARIANT[r.status] ?? 'muted'}>
      {r.status}
    </Badge>,
    `+${r.rowsInserted} / ~${r.rowsUpdated} / −${r.rowsSkipped}`,
    formatDate(r.startedAt, locale),
    r.message ?? '—',
  ]);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <section className="space-y-2">
        <DataTable columns={connectorCols} rows={connectorRows} emptyLabel="—" />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t('runs')}</h3>
        <DataTable columns={runCols} rows={runRows} emptyLabel="—" />
      </section>
    </>
  );
}
