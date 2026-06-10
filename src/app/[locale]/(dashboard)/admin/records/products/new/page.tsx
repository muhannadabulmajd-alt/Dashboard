import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { PageHeader } from '@/components/ui/primitives';
import { RecordForm } from '@/components/records/form';
import { BackLink } from '@/components/records/parts';
import { createProduct } from '@/server/records/products';
import { getListOptions } from '@/server/lists/resolver';
import { productFields } from '../_fields';

/** Active parent groups as form options (value = id, label = code · name). */
async function groupOptions(locale: string) {
  const groups = await prisma.productGroup.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  return groups.map((g) => ({ value: g.id, label: `${g.code} · ${locale === 'ar' ? g.nameAr : g.nameEn}` }));
}

export default async function NewProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:products');
  const sp = await searchParams;
  const t = await getTranslations('records');
  const tk = (k: string) => t(k);
  const [groups, grinds, roastLevels] = await Promise.all([
    groupOptions(locale),
    getListOptions('grind', locale),
    getListOptions('roastLevel', locale),
  ]);
  const errors = { invalid: t('err.invalid'), exists: t('err.exists'), forbidden: t('err.forbidden') };

  // When adding a variation from a main product, pre-select it and inherit its
  // category so the user only fills in what's specific to the variation.
  const groupId = typeof sp.group === 'string' ? sp.group : '';
  const parent = groupId
    ? await prisma.productGroup.findUnique({ where: { id: groupId }, select: { id: true, productLine: true } })
    : null;
  const initial = parent ? { groupId: parent.id, productLine: parent.productLine } : undefined;
  const backHref = parent ? `/admin/records/product-groups/${parent.id}?tab=variations` : '/admin/records/products';

  return (
    <>
      <BackLink href={backHref} label={t('back')} />
      <PageHeader title={t('newTitle', { entity: t('f.variation') })} />
      <RecordForm
        action={createProduct}
        fields={productFields(tk, locale, 'new', groups, { grinds, roastLevels })}
        initial={initial}
        locale={locale}
        submitLabel={t('create')}
        cancelHref={backHref}
        cancelLabel={t('cancel')}
        errors={errors}
      />
    </>
  );
}
