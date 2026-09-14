import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { Badge, PageHeader } from '@/components/ui/primitives';
import { formatDate } from '@/lib/dates';
import { formatQuantity } from '@/lib/money';
import { Link } from '@/i18n/navigation';
import { getPageContext } from '@/server/page-context';
import { getInventoryV2Config } from '@/server/inventory-v2/config';
import { getReturnIndexData } from '@/server/inventory-v2/operations-read';

export default async function ReturnedGoodsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'manage:inventory');
  if (!getInventoryV2Config().enabled) notFound();
  const t = await getTranslations('records');
  const rows = await getReturnIndexData(user);
  const columns: Column[] = [
    { label: t('inventoryV2.operations.document') },
    { label: t('inventoryV2.operations.date') },
    { label: t('f.order') },
    { label: t('inventoryV2.operations.item') },
    { label: t('inventoryV2.operations.returnedQuantity'), align: 'end' },
    { label: t('inventoryV2.operations.outstanding'), align: 'end' },
    { label: t('inventoryV2.operations.status') },
    { label: '' },
  ];
  const tableRows = rows.map(({ document, returnedQuantity, outstandingQuantity }) => {
    const firstMovement = document.movements[0];
    const status = outstandingQuantity <= 1e-9 ? 'resolved' : 'quarantined';
    return [
      document.documentNumber,
      formatDate(document.occurredAt, locale),
      firstMovement?.order?.orderNumber ?? '—',
      firstMovement
        ? (locale === 'ar' ? firstMovement.inventoryItem.nameAr : firstMovement.inventoryItem.nameEn)
        : '—',
      firstMovement
        ? `${formatQuantity(returnedQuantity, locale)} ${firstMovement.inventoryItem.unit}`
        : formatQuantity(returnedQuantity, locale),
      firstMovement
        ? `${formatQuantity(outstandingQuantity, locale)} ${firstMovement.inventoryItem.unit}`
        : formatQuantity(outstandingQuantity, locale),
      <Badge key="status" variant={status === 'resolved' ? 'success' : 'warning'}>
        {t(`inventoryV2.operations.${status}`)}
      </Badge>,
      <Link key="open" href={`/admin/records/inventory/returns/${document.id}`} className="font-semibold text-primary hover:underline">
        {t('open')}
      </Link>,
    ];
  });

  return (
    <>
      <BackLink href="/admin/records/inventory" label={t('back')} />
      <PageHeader title={t('inventoryV2.operations.returnsTitle')} subtitle={t('inventoryV2.operations.returnsHint')} />
      <DataTable columns={columns} rows={tableRows} emptyLabel={t('inventoryV2.operations.noReturns')} />
    </>
  );
}
