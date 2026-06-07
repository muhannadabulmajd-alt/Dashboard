import { getTranslations } from 'next-intl/server';
import { Info } from 'lucide-react';
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
      <div className="flex items-start gap-2 rounded-[var(--radius)] border bg-muted/40 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <span>{t('fixed')}</span>
      </div>
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
