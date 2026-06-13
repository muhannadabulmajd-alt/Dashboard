import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { formatDateTime } from '@/lib/dates';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';

const ACTION_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'muted'> = {
  CREATE: 'success',
  UPDATE: 'muted',
  DELETE: 'danger',
  ARCHIVE: 'warning',
  RESTORE: 'success',
  COST_CHANGE: 'warning',
  REVERSE: 'danger',
  SETTLE: 'success',
  ASSIGN_ACCOUNT: 'warning',
  EXPORT: 'muted',
  cleanup_duplicate_imports: 'danger',
};

/** Compact one-line summary of an audit entry's JSON metadata. */
function summarize(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return '—';
  const parts = Object.entries(meta as Record<string, unknown>).map(([k, v]) => {
    const value = v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—');
    return `${k}: ${value}`;
  });
  const s = parts.join(' · ');
  return s.length > 320 ? `${s.slice(0, 320)}...` : s || '—';
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:users');
  const t = await getTranslations('audit');

  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { name: true, email: true } } },
  });

  const cols: Column[] = [
    { label: t('when') },
    { label: t('user') },
    { label: t('action') },
    { label: t('entity') },
    { label: 'ID' },
    { label: t('details') },
  ];
  const rows = logs.map((l) => [
    formatDateTime(l.createdAt, locale),
    l.user?.name ?? l.user?.email ?? t('system'),
    <Badge key="a" variant={ACTION_VARIANT[l.action] ?? 'muted'}>
      {l.action}
    </Badge>,
    l.entity ?? '—',
    l.entityId ? <span key="id" className="font-mono text-xs">{l.entityId.slice(-10)}</span> : '—',
    <span key="d" className="text-xs text-muted-foreground">
      {summarize(l.metadata)}
    </span>,
  ]);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <DataTable columns={cols} rows={rows} emptyLabel={t('system')} />
    </>
  );
}
