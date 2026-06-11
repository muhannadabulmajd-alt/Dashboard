import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { formatDateTime } from '@/lib/dates';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { SectionGuide } from '@/components/records/SectionGuide';

const ACTION_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'muted'> = {
  CREATE: 'success',
  UPDATE: 'warning',
  REVERSE: 'danger',
  SETTLE: 'success',
  ASSIGN_ACCOUNT: 'warning',
  EXPORT: 'muted',
};

function summarize(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return '—';
  const parts = Object.entries(meta as Record<string, unknown>).map(([key, value]) => {
    const text = value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—');
    return `${key}: ${text}`;
  });
  const summary = parts.join(' · ');
  return summary.length > 180 ? `${summary.slice(0, 180)}...` : summary || '—';
}

export default async function FinanceAuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'view:finance');
  const t = await getTranslations('finance');
  const ta = await getTranslations('audit');
  const tr = await getTranslations('records');

  const logs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entity: 'FinanceEntry' },
        { entity: 'FinanceAccount' },
        { entity: 'Party' },
        { entity: 'finance' },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 250,
    include: { user: { select: { name: true, email: true } } },
  });

  const cols: Column[] = [
    { label: ta('when') },
    { label: ta('user') },
    { label: ta('action') },
    { label: ta('entity') },
    { label: ta('details') },
  ];
  const rows = logs.map((log) => [
    formatDateTime(log.createdAt, locale),
    log.user?.name ?? log.user?.email ?? ta('system'),
    <Badge key="a" variant={ACTION_VARIANT[log.action] ?? 'muted'}>
      {log.action}
    </Badge>,
    log.entity ?? '—',
    <span key="d" className="text-xs text-muted-foreground">
      {summarize(log.metadata)}
    </span>,
  ]);

  return (
    <>
      <BackLink href="/finance" label={tr('back')} />
      <PageHeader title={t('auditLog')} subtitle={t('auditLogSubtitle')} />
      <SectionGuide
        title={t('guide.audit.title')}
        intro={t('guide.audit.intro')}
        points={t.raw('guide.audit.points')}
      />
      <DataTable columns={cols} rows={rows} emptyLabel={ta('system')} />
    </>
  );
}
