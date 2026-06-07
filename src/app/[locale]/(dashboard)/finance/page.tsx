import { getTranslations } from 'next-intl/server';
import {
  Wallet,
  Landmark,
  TrendingDown,
  TrendingUp,
  Clock,
  HandCoins,
  Users,
  BookOpen,
  PieChart,
  Plus,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import { accountBalance, financeTotals, type FinanceEntryLike } from '@/lib/metrics/finance';
import { PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { Link } from '@/i18n/navigation';

type Tone = 'in' | 'out' | 'neutral' | 'warn';
const TONES: Record<Tone, string> = {
  in: 'bg-success-soft text-success',
  out: 'bg-danger-soft text-danger',
  neutral: 'bg-primary/10 text-primary',
  warn: 'bg-warning-soft text-warning',
};

function Kpi({
  label,
  value,
  Icon,
  tone,
  href,
}: {
  label: string;
  value: string;
  Icon: LucideIcon;
  tone: Tone;
  href?: string;
}) {
  const body = (
    <div className="flex h-full items-start gap-3 rounded-[var(--radius)] border bg-card p-4 transition-colors hover:border-primary/40">
      <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', TONES[tone])}>
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-1 truncate text-xl font-bold tabular-nums text-foreground" title={value}>
          {value}
        </div>
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export default async function FinancePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'view:finance');
  const t = await getTranslations('finance');
  const canManage = can(user.role, 'manage:finance');

  const [accounts, entriesRaw] = await Promise.all([
    prisma.financeAccount.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }),
    prisma.financeEntry.findMany({
      select: {
        id: true, type: true, amount: true, currency: true, obligation: true,
        obligationKind: true, accountId: true, toAccountId: true, settlesId: true,
      },
    }),
  ]);
  const entries = entriesRaw as FinanceEntryLike[];

  const currencies = Array.from(new Set([...accounts.map((a) => a.currency), ...entries.map((e) => e.currency)]));
  if (currencies.length === 0) currencies.push('IQD');

  const accCols: Column[] = [
    { label: t('f.name') },
    { label: t('f.type') },
    { label: t('f.balance'), align: 'end' },
  ];

  const cards: { href: string; key: string; Icon: LucideIcon }[] = [
    { href: '/finance/ledger', key: 'ledger', Icon: BookOpen },
    { href: '/finance/dues', key: 'dues', Icon: Clock },
    { href: '/finance/shareholders', key: 'shareholders', Icon: PieChart },
    { href: '/finance/accounts', key: 'accounts', Icon: Wallet },
    { href: '/finance/parties', key: 'parties', Icon: Users },
  ];

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        {canManage ? (
          <Link
            href="/finance/ledger/new"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-95"
          >
            <Plus className="size-4" />
            {t('recordEntry')}
          </Link>
        ) : null}
      </div>

      {currencies.map((cur) => {
        const ce = entries.filter((e) => e.currency === cur);
        const ca = accounts.filter((a) => a.currency === cur);
        const tot = financeTotals(ce);
        const cash = ca.reduce((s, a) => s + accountBalance(a, ce), 0);
        const tiles: { label: string; value: number; Icon: LucideIcon; tone: Tone; href?: string }[] = [
          { label: t('cashOnHand'), value: cash, Icon: Wallet, tone: 'neutral', href: '/finance/accounts' },
          { label: t('capital'), value: tot.capitalIn, Icon: Landmark, tone: 'in', href: '/finance/shareholders' },
          { label: t('spent'), value: tot.expenses, Icon: TrendingDown, tone: 'out', href: '/finance/ledger' },
          { label: t('received'), value: tot.received, Icon: TrendingUp, tone: 'in', href: '/finance/ledger' },
          { label: t('payables'), value: tot.outstandingPayable, Icon: Clock, tone: 'warn', href: '/finance/dues' },
          { label: t('receivables'), value: tot.outstandingReceivable, Icon: HandCoins, tone: 'in', href: '/finance/dues' },
        ];
        return (
          <section key={cur} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="rounded-md border bg-card px-2 py-0.5 text-xs font-bold tracking-wide text-muted-foreground">
                {cur}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {tiles.map((tile) => (
                <Kpi
                  key={tile.label}
                  label={tile.label}
                  value={formatMoney(tile.value, cur, locale)}
                  Icon={tile.Icon}
                  tone={tile.tone}
                  href={tile.href}
                />
              ))}
            </div>
            {ca.length ? (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">{t('byAccount')}</div>
                <DataTable
                  columns={accCols}
                  rows={ca.map((a) => [
                    a.name,
                    enumLabel(a.type, locale),
                    formatMoney(accountBalance(a, ce), cur, locale),
                  ])}
                  emptyLabel="—"
                />
              </div>
            ) : null}
          </section>
        );
      })}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ href, key, Icon }) => (
          <Link
            key={key}
            href={href}
            className="group flex items-center gap-3 rounded-[var(--radius)] border bg-card p-4 hover:border-primary hover:shadow-sm"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">{t(key)}</div>
              <div className="truncate text-xs text-muted-foreground">{t(`entityHints.${key}`)}</div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180 group-hover:text-primary" />
          </Link>
        ))}
      </div>
    </>
  );
}
