import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { createCustomer } from '@/server/records/customers';
import { getListOptions } from '@/server/lists/resolver';
import { customerFields } from '../_fields';

export default async function NewCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:customers');
  const t = await getTranslations('records');
  const tk = (k: string) => t(k);
  const sources = (await getListOptions('customerSource', locale)).map((o) => o.value);
  const errors = { invalid: t('err.invalid'), exists: t('err.exists'), forbidden: t('err.forbidden') };

  return (
    <>
      <BackLink href="/admin/records/customers" label={t('back')} />
      <PageHeader title={t('newTitle', { entity: t('entities.customers') })} />
      <RecordForm
        action={createCustomer}
        fields={customerFields(tk, locale, 'new', sources)}
        locale={locale}
        submitLabel={t('create')}
        cancelHref="/admin/records/customers"
        cancelLabel={t('cancel')}
        errors={errors}
      />
    </>
  );
}
