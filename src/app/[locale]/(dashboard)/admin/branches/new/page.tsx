import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { createBranch } from '@/server/branches/actions';
import { getListOptions } from '@/server/lists/resolver';
import { branchFields } from '../_fields';

export default async function NewBranchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:branches');
  const t = await getTranslations('branches');
  const tr = await getTranslations('records');
  const governorates = await getListOptions('governorate', locale);
  const errors = { invalid: tr('err.invalid'), exists: t('exists'), forbidden: tr('err.forbidden') };

  return (
    <>
      <BackLink href="/admin/branches" label={tr('back')} />
      <PageHeader title={t('newTitle')} />
      <RecordForm
        action={createBranch}
        fields={branchFields((k) => t(k), locale, 'new', governorates)}
        locale={locale}
        submitLabel={t('create')}
        cancelHref="/admin/branches"
        cancelLabel={tr('cancel')}
        errors={errors}
      />
    </>
  );
}
