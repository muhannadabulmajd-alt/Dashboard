import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { updateOrder } from '@/server/records/orders';
import { orderFields } from '../../_fields';

export default async function EditOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:orders');
  const { id } = await params;
  const t = await getTranslations('records');
  const tk = (k: string) => t(k);
  const o = await prisma.order.findUnique({ where: { id }, include: { customer: true } });
  if (!o) notFound();

  const initial = {
    orderNumber: o.orderNumber,
    placedAt: o.placedAt.toISOString().slice(0, 10),
    customerExternalId: o.customer?.externalId ?? '',
    channel: o.channel,
    governorate: o.governorate,
    fulfillmentMethod: o.fulfillmentMethod,
    status: o.status,
    deliveryFee: o.deliveryFee,
    deliveryCost: o.deliveryCost,
  };
  const errors = { invalid: t('err.invalid'), exists: t('err.exists'), forbidden: t('err.forbidden') };

  return (
    <>
      <BackLink href={`/admin/records/orders/${id}`} label={t('back')} />
      <PageHeader title={t('editTitle', { entity: t('entities.orders') })} subtitle={o.orderNumber} />
      <RecordForm
        action={updateOrder.bind(null, id)}
        fields={orderFields(tk, locale)}
        initial={initial}
        locale={locale}
        submitLabel={t('save')}
        cancelHref={`/admin/records/orders/${id}`}
        cancelLabel={t('cancel')}
        errors={errors}
      />
    </>
  );
}
