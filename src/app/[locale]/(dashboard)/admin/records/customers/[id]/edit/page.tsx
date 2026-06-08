import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { CUSTOMER_SOURCES } from '@/lib/enums';
import { updateCustomer } from '@/server/records/customers';
import { customerFields } from '../../_fields';

export default async function EditCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:customers');
  const { id } = await params;
  const t = await getTranslations('records');
  const tk = (k: string) => t(k);
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c) notFound();

  const initial = {
    externalId: c.externalId ?? '',
    nameEn: c.nameEn ?? '',
    nameAr: c.nameAr ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    governorate: c.governorate ?? '',
    address1: c.address1 ?? '',
    street: c.street ?? '',
    notes: c.notes ?? '',
    segment: c.segment,
    campaignSource: c.campaignSource ?? '',
  };
  // Keep any legacy/custom source value selectable so editing never wipes it.
  const sources =
    c.campaignSource && !CUSTOMER_SOURCES.includes(c.campaignSource as (typeof CUSTOMER_SOURCES)[number])
      ? [...CUSTOMER_SOURCES, c.campaignSource]
      : CUSTOMER_SOURCES;
  const errors = { invalid: t('err.invalid'), exists: t('err.exists'), forbidden: t('err.forbidden') };

  return (
    <>
      <BackLink href={`/admin/records/customers/${id}`} label={t('back')} />
      <PageHeader title={t('editTitle', { entity: t('entities.customers') })} subtitle={c.externalId ?? ''} />
      <RecordForm
        action={updateCustomer.bind(null, id)}
        fields={customerFields(tk, locale, 'edit', sources)}
        initial={initial}
        locale={locale}
        submitLabel={t('save')}
        cancelHref={`/admin/records/customers/${id}`}
        cancelLabel={t('cancel')}
        errors={errors}
      />
    </>
  );
}
