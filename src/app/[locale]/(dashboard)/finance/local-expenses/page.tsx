import { randomUUID } from 'node:crypto';
import { formatInTimeZone } from 'date-fns-tz';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { can } from '@/lib/rbac';
import { enumLabel, LOCAL_OPEX_CATEGORY_TYPES } from '@/lib/enums';
import { TZ, formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import { hasGlobalLocationAccess, stockLocationWhereForPermission } from '@/server/inventory-v2/access';
import { localExpenseAccountMatchesLocation } from '@/server/inventory-v2/local-expense-policy';
import {
  recordLocalExpenseAction,
  reviewLocalExpenseAction,
} from '@/server/inventory-v2/local-expense-actions';
import { LocalExpenseForm, LocalExpenseReviewForm } from '@/components/finance/LocalExpenseForms';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { Link } from '@/i18n/navigation';

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default async function LocalExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'record:local-expense');
  if (!getInventoryV2Config().enabled) notFound();
  const rawSearch = await searchParams;
  const t = await getTranslations('finance.localExpenses');
  const [locationsRaw, defaultAccount, requests] = await Promise.all([
    prisma.stockLocation.findMany({
      where: {
        isActive: true,
        ...stockLocationWhereForPermission(user, 'recordExpense'),
      },
      include: { branch: { select: { code: true, nameEn: true, nameAr: true } } },
      orderBy: [{ branch: { code: 'asc' } }, { nameEn: 'asc' }],
    }),
    user.defaultFinanceAccountId
      ? prisma.financeAccount.findUnique({ where: { id: user.defaultFinanceAccountId } })
      : Promise.resolve(null),
    prisma.localExpenseRequest.findMany({
      where: hasGlobalLocationAccess(user.role)
        ? {}
        : {
            location: {
              userAccesses: { some: { userId: user.id, canView: true } },
            },
          },
      include: {
        location: { include: { branch: { select: { nameEn: true, nameAr: true } } } },
        account: { select: { name: true } },
        submittedBy: { select: { name: true, email: true } },
        reviewedBy: { select: { name: true, email: true } },
        attachment: { select: { id: true, fileName: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 250,
    }),
  ]);
  const locations = locationsRaw.map((location) => ({
    id: location.id,
    label: `${location.code} · ${locale === 'ar' ? location.nameAr : location.nameEn}`,
    stockVersion: location.stockVersion,
    accountEligible: Boolean(defaultAccount && localExpenseAccountMatchesLocation(defaultAccount, location)),
  }));
  const created = one(rawSearch.created);
  const reviewed = one(rawSearch.reviewed);
  const today = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
  const canReview = user.role === 'OWNER' || user.role === 'ADMIN';
  const canOpenLedger = can(user.role, 'view:finance');
  const pendingRequests = canReview ? requests.filter((request) => request.status === 'SUBMITTED') : [];
  const labels = {
    location: t('location'),
    amount: t('amount'),
    date: t('date'),
    category: t('category'),
    description: t('description'),
    evidence: t('evidence'),
    receipt: t('receipt'),
    noReceipt: t('noReceipt'),
    noReceiptReason: t('noReceiptReason'),
    receiptHint: t('receiptHint'),
    fileTooLarge: t('fileTooLarge'),
    account: t('account'),
    accountMissing: t('accountMissing'),
    accountLocationMismatch: t('accountLocationMismatch'),
    submit: t('submit'),
  };
  const errors: Record<string, string> = {
    forbidden: t('errors.forbidden'),
    invalid_input: t('errors.invalid'),
    inventory_v2_disabled: t('errors.disabled'),
    location_not_found: t('errors.locationNotFound'),
    location_recordExpense_forbidden: t('errors.forbidden'),
    location_stale: t('errors.stale'),
    expense_default_account_required: t('errors.accountRequired'),
    expense_default_account_invalid: t('errors.accountInvalid'),
    expense_receipt_type_unsupported: t('errors.receiptType'),
    attachment_type_unsupported: t('errors.receiptType'),
    attachment_mime_mismatch: t('errors.receiptMismatch'),
    attachment_too_large: t('errors.receiptLarge'),
    expense_request_not_found: t('errors.notFound'),
    expense_request_stale: t('errors.stale'),
    expense_request_already_reviewed: t('errors.alreadyReviewed'),
    idempotency_conflict: t('errors.idempotency'),
  };
  const columns: Column[] = [
    { label: t('request') },
    { label: t('date') },
    { label: t('location') },
    { label: t('description') },
    { label: t('category') },
    { label: t('amount'), align: 'end' },
    { label: t('submittedBy') },
    { label: t('status') },
    { label: t('evidence') },
    { label: '' },
  ];
  const statusBadge = (status: string) => {
    if (status === 'POSTED') return <Badge variant="success">{t('statuses.posted')}</Badge>;
    if (status === 'REJECTED') return <Badge variant="danger">{t('statuses.rejected')}</Badge>;
    return <Badge variant="warning">{t('statuses.submitted')}</Badge>;
  };
  const rows = requests.map((request) => [
    request.requestNumber,
    formatDate(request.date, locale),
    `${locale === 'ar' ? request.location.nameAr : request.location.nameEn} · ${locale === 'ar' ? request.location.branch.nameAr : request.location.branch.nameEn}`,
    request.description,
    enumLabel(request.categoryType, locale),
    formatMoney(request.amount, 'IQD', locale),
    request.submittedBy.name || request.submittedBy.email,
    statusBadge(request.status),
    request.attachment ? (
      <a key={request.attachment.id} href={`/api/finance/local-expenses/attachments/${request.attachment.id}`} className="font-semibold text-primary hover:underline">
        {t('downloadReceipt')}
      </a>
    ) : request.noReceiptReason ?? '—',
    canOpenLedger && request.financeEntryId ? (
      <Link key={request.financeEntryId} href={`/finance/ledger/${request.financeEntryId}`} className="font-semibold text-primary hover:underline">
        {t('openLedgerEntry')}
      </Link>
    ) : '—',
  ]);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {created ? (
        <p role="status" className="mb-4 rounded-lg border border-success/25 bg-success-soft p-3 text-sm font-semibold text-success">
          {t('created', { number: created })}
        </p>
      ) : null}
      {reviewed ? (
        <p role="status" className="mb-4 rounded-lg border border-success/25 bg-success-soft p-3 text-sm font-semibold text-success">
          {t('reviewed', { number: reviewed })}
        </p>
      ) : null}
      {!locations.length ? (
        <p className="rounded-lg border border-warning/25 bg-warning-soft p-4 text-sm text-warning">{t('noLocations')}</p>
      ) : (
        <LocalExpenseForm
          action={recordLocalExpenseAction}
          locale={locale}
          idempotencyKey={`local-expense:web:${randomUUID()}`}
          occurredAt={today}
          locations={locations}
          categories={LOCAL_OPEX_CATEGORY_TYPES.map((value) => ({ value, label: enumLabel(value, locale) }))}
          accountLabel={defaultAccount ? `${defaultAccount.name} (${defaultAccount.currency})` : null}
          labels={labels}
          errors={errors}
        />
      )}

      {canReview ? (
        <section className="mt-6 space-y-3">
          <div>
            <h2 className="text-base font-bold">{t('reviewTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('reviewHint')}</p>
          </div>
          {pendingRequests.length ? pendingRequests.map((request) => (
            <article key={request.id} className="rounded-[var(--radius)] border border-warning/25 bg-warning-soft/30 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-bold">{request.requestNumber} · {formatMoney(request.amount, 'IQD', locale)}</p>
                  <p className="mt-1 text-sm">{request.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {locale === 'ar' ? request.location.nameAr : request.location.nameEn} · {enumLabel(request.categoryType, locale)} · {request.submittedBy.name || request.submittedBy.email}
                  </p>
                </div>
                {request.attachment ? (
                  <a href={`/api/finance/local-expenses/attachments/${request.attachment.id}`} className="text-sm font-semibold text-primary hover:underline">
                    {t('downloadReceipt')}
                  </a>
                ) : <span className="max-w-md text-xs text-muted-foreground">{t('noReceiptReason')}: {request.noReceiptReason}</span>}
              </div>
              <LocalExpenseReviewForm
                action={reviewLocalExpenseAction.bind(null, request.id)}
                locale={locale}
                idempotencyKey={`local-expense-review:web:${randomUUID()}`}
                occurredAt={new Date().toISOString()}
                expectedRequestVersion={request.version}
                expectedLocationVersion={request.location.stockVersion}
                labels={{ reviewReason: t('reviewReason'), approve: t('approve'), reject: t('reject') }}
                errors={errors}
              />
            </article>
          )) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t('noPending')}</p>
          )}
        </section>
      ) : null}

      <section className="mt-6 space-y-3">
        <h2 className="text-base font-bold">{t('historyTitle')}</h2>
        <DataTable columns={columns} rows={rows} emptyLabel={t('noHistory')} />
      </section>
    </>
  );
}
