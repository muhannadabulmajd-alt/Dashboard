import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { formatMoney } from '@/lib/money';
import { PageHeader } from '@/components/ui/primitives';
import { BackLink } from '@/components/records/parts';
import { ComponentEditor, type ComponentRow } from '@/components/records/ComponentEditor';
import { saveProductComponents } from '@/server/records/products';

export default async function ProductCostPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:products');
  const { id } = await params;
  const t = await getTranslations('records');
  const p = await prisma.product.findUnique({
    where: { id },
    include: { components: { orderBy: { id: 'asc' } } },
  });
  if (!p) notFound();

  const initial: ComponentRow[] = p.components.map((c) => ({
    name: c.name,
    quantity: String(c.quantity),
    unitCost: String(c.unitCost),
  }));
  const labels = {
    components: t('costRecipe'),
    name: t('f.name'),
    quantity: t('f.qty'),
    unitCost: t('f.unitCost'),
    total: t('f.cost'),
    add: t('addLine'),
    remove: t('removeLine'),
    save: t('save'),
    cancel: t('cancel'),
  };
  const errors = { invalid: t('err.invalid'), forbidden: t('err.forbidden') };

  return (
    <>
      <BackLink href={`/admin/records/products/${id}`} label={t('back')} />
      <PageHeader title={t('costRecipe')} subtitle={`${p.sku} · ${t('f.cost')}: ${formatMoney(p.cogsPerUnit, p.sellingCurrency, locale)}`} />
      <p className="text-xs text-muted-foreground">{t('costRecipeHint')}</p>
      <ComponentEditor
        action={saveProductComponents.bind(null, id)}
        locale={locale}
        initial={initial}
        labels={labels}
        errors={errors}
        cancelHref={`/admin/records/products/${id}`}
      />
    </>
  );
}
