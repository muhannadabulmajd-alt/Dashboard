import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/rbac';
import { linkPaymentReconciliationItem } from '@/server/finance/payment-reconciliation';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { BackLink } from '@/components/records/parts';
import { DataTable } from '@/components/data-table/DataTable';
import { KpiCard } from '@/components/kpi/KpiCard';
import { Link } from '@/i18n/navigation';

export default async function OnlinePaymentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'view:finance');
  const t = await getTranslations('finance');
  const ownerAdmin = user.role === 'OWNER' || user.role === 'ADMIN';
  const [items, pendingOrders, statementSettings] = await Promise.all([
    prisma.paymentReconciliationItem.findMany({
      where: { provider: { externalKey: 'WAYL' } },
      orderBy: [{ status: 'asc' }, { occurredAt: 'desc' }],
      include: {
        provider: { select: { name: true } },
        order: { select: { id: true, orderNumber: true } },
      },
    }),
    ownerAdmin && can(user.role, 'manage:finance')
      ? prisma.order.findMany({
          where: { status: { not: 'COMPLETED' }, purpose: 'SALE' },
          orderBy: { placedAt: 'desc' },
          select: {
            id: true,
            orderNumber: true,
            grossAmount: true,
            discountAmount: true,
            refundAmount: true,
            deliveryFee: true,
            extraCharges: true,
          },
        })
      : [],
    prisma.setting.findMany({
      where: {
        key: {
          in: [
            'wayl_statement_gross',
            'wayl_statement_commission',
            'wayl_statement_payouts',
            'wayl_statement_wallet_balance',
          ],
        },
      },
      select: { key: true, value: true },
    }),
  ]);
  const statement = new Map(
    statementSettings.map((setting) => [setting.key, Number(setting.value) || 0]),
  );

  const candidates = pendingOrders.map((order) => ({
    id: order.id,
    label: `${order.orderNumber} · ${formatMoney(
      Math.max(
        0,
        order.grossAmount -
          order.discountAmount -
          order.refundAmount +
          order.deliveryFee +
          order.extraCharges,
      ),
      'IQD',
      locale,
    )}`,
  }));

  return (
    <>
      <BackLink href="/finance" label={t('title')} />
      <PageHeader title={t('onlinePaymentReview')} subtitle={t('onlinePaymentReviewHint')} />
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={t('grossPayment')}
          value={formatMoney(statement.get('wayl_statement_gross') ?? 0, 'IQD', locale)}
          locale={locale}
        />
        <KpiCard
          label={t('gatewayFee')}
          value={formatMoney(statement.get('wayl_statement_commission') ?? 0, 'IQD', locale)}
          locale={locale}
        />
        <KpiCard
          label={t('statementPayouts')}
          value={formatMoney(statement.get('wayl_statement_payouts') ?? 0, 'IQD', locale)}
          locale={locale}
        />
        <KpiCard
          label={t('walletBalance')}
          value={formatMoney(statement.get('wayl_statement_wallet_balance') ?? 0, 'IQD', locale)}
          locale={locale}
        />
      </section>
      <DataTable
        columns={[
          { label: t('f.date') },
          { label: t('f.reference') },
          { label: t('f.party') },
          { label: t('grossPayment'), align: 'end' },
          { label: t('gatewayFee'), align: 'end' },
          { label: t('netPayment'), align: 'end' },
          { label: t('f.status') },
          { label: t('f.related') },
        ]}
        rows={items.map((item) => [
          formatDate(item.occurredAt, locale),
          item.externalCode,
          item.provider.name,
          formatMoney(item.grossAmount, 'IQD', locale),
          formatMoney(item.feeAmount, 'IQD', locale),
          formatMoney(item.netAmount, 'IQD', locale),
          <Badge key={`status-${item.id}`} variant={item.status === 'LINKED' ? 'success' : 'warning'}>
            {item.status === 'LINKED' ? t('paymentLinked') : t('paymentNeedsOrder')}
          </Badge>,
          item.order ? (
            <Link key={`order-${item.id}`} href={`/admin/records/orders/${item.order.id}`}>
              {item.order.orderNumber}
            </Link>
          ) : ownerAdmin ? (
            <form
              key={`link-${item.id}`}
              action={linkPaymentReconciliationItem.bind(null, item.id)}
              className="flex min-w-72 flex-col gap-1.5 sm:flex-row"
            >
              <select name="orderId" required className="min-h-10 flex-1 rounded-lg border bg-background px-2 text-xs">
                <option value="">{t('selectMatchingOrder')}</option>
                {candidates.filter((order) => {
                  const pendingOrder = pendingOrders.find((row) => row.id === order.id);
                  if (!pendingOrder) return false;
                  const total = Math.max(
                    0,
                    pendingOrder.grossAmount -
                      pendingOrder.discountAmount -
                      pendingOrder.refundAmount +
                      pendingOrder.deliveryFee +
                      pendingOrder.extraCharges,
                  );
                  return total === item.grossAmount;
                }).map((order) => (
                  <option key={order.id} value={order.id}>{order.label}</option>
                ))}
              </select>
              <button className="min-h-10 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground">
                {t('linkPayment')}
              </button>
            </form>
          ) : '—',
        ])}
        emptyLabel={t('noOnlinePayments')}
      />
    </>
  );
}
