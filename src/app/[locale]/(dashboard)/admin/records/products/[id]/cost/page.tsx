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
  const [p, itemRows] = await Promise.all([
    prisma.product.findUnique({ where: { id }, include: { components: { orderBy: { id: 'asc' } } } }),
    prisma.inventoryItem.findMany({
      where: { isActive: true },
      orderBy: { nameEn: 'asc' },
      select: { id: true, nameEn: true, nameAr: true, unit: true, unitCost: true },
    }),
  ]);
  if (!p) notFound();
  const items = itemRows.map((it) => ({
    value: it.id,
    label: `${locale === 'ar' ? it.nameAr : it.nameEn} (${it.unit})`,
    cost: it.unitCost ?? 0,
  }));

  const initial: ComponentRow[] = p.components.map((c) => ({
    inventoryItemId: c.inventoryItemId ?? '',
    name: c.name,
    quantity: String(c.quantity),
    unitCost: String(c.unitCost),
  }));
  const labels = {
    components: t('costRecipe'),
    item: t('f.item'),
    manual: t('manual'),
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
        items={items}
        labels={labels}
        errors={errors}
        cancelHref={`/admin/records/products/${id}`}
      />
    </>
  );
}
