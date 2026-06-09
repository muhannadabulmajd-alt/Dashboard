import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import {
  enumLabel,
  CHANNELS,
  GOVERNORATES,
  PRODUCT_LINES,
  GRINDS,
  ROAST_LEVELS,
  CUSTOMER_SEGMENTS,
  FULFILLMENT_METHODS,
  ORDER_STATUSES,
  INVENTORY_CATEGORIES,
  EXPENSE_CATEGORY_TYPES,
  ACCOUNT_TYPES,
  PARTY_TYPES,
  FINANCE_TYPES,
} from '@/lib/enums';
import { PageHeader } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { BackLink } from '@/components/records/parts';
import { SectionGuide } from '@/components/records/SectionGuide';

const SECTIONS: { key: string; values: readonly string[] }[] = [
  { key: 'channels', values: CHANNELS },
  { key: 'governorates', values: GOVERNORATES },
  { key: 'productLines', values: PRODUCT_LINES },
  { key: 'grinds', values: GRINDS },
  { key: 'roastLevels', values: ROAST_LEVELS },
  { key: 'customerSegments', values: CUSTOMER_SEGMENTS },
  { key: 'fulfillment', values: FULFILLMENT_METHODS },
  { key: 'orderStatuses', values: ORDER_STATUSES },
  { key: 'inventoryCategories', values: INVENTORY_CATEGORIES },
  { key: 'expenseCategories', values: EXPENSE_CATEGORY_TYPES },
  { key: 'accountTypes', values: ACCOUNT_TYPES },
  { key: 'partyTypes', values: PARTY_TYPES },
  { key: 'financeTypes', values: FINANCE_TYPES },
];

export default async function SystemListsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await getPageContext(params, searchParams, 'view:records');
  const t = await getTranslations('records.systemLists');
  const tr = await getTranslations('records');

  const cols: Column[] = [{ label: t('value') }, { label: t('en') }, { label: t('ar') }];

  return (
    <>
      <BackLink href="/admin/records" label={tr('back')} />
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <SectionGuide title={tr('guide.systemLists.title')} intro={tr('guide.systemLists.intro')} points={tr.raw('guide.systemLists.points') as string[]} />
      <div className="grid gap-4 lg:grid-cols-2">
        {SECTIONS.map((s) => (
          <div key={s.key} className="space-y-1.5">
            <h3 className="text-sm font-semibold">{t(`sections.${s.key}`)}</h3>
            <DataTable
              columns={cols}
              rows={s.values.map((v) => [v, enumLabel(v, 'en'), enumLabel(v, 'ar')])}
              emptyLabel="—"
            />
          </div>
        ))}
      </div>
    </>
  );
}
