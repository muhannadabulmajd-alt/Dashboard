import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { prisma } from '@/server/db/client';
import { BackLink } from '@/components/records/parts';
import { PageHeader } from '@/components/ui/primitives';
import { createDeliveryZone, setDeliveryZoneActive, updateDeliveryZone } from '@/server/storefront/delivery-zones';

const input = 'min-h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary';

function ZoneFields({
  labels,
  zone,
}: {
  labels: Record<string, string>;
  zone?: {
    code: string;
    nameEn: string;
    nameAr: string;
    governorate: string | null;
    deliveryFee: number;
    minimumOrder: number;
    freeDeliveryAt: number | null;
    sortOrder: number;
  };
}) {
  const fields = [
    ['code', labels.code, zone?.code ?? '', 'text', true],
    ['nameEn', labels.nameEn, zone?.nameEn ?? '', 'text', false],
    ['nameAr', labels.nameAr, zone?.nameAr ?? '', 'text', false],
    ['governorate', labels.governorate, zone?.governorate ?? '', 'text', false],
    ['deliveryFee', labels.deliveryFee, zone?.deliveryFee ?? 0, 'number', false],
    ['minimumOrder', labels.minimumOrder, zone?.minimumOrder ?? 0, 'number', false],
    ['freeDeliveryAt', labels.freeDeliveryAt, zone?.freeDeliveryAt ?? '', 'number', false],
    ['sortOrder', labels.sortOrder, zone?.sortOrder ?? 0, 'number', false],
  ] as const;
  return fields.map(([name, label, value, type, immutable]) => (
    <label key={name} className="grid gap-1 text-xs font-semibold text-muted-foreground">
      {label}
      <input
        className={`${input} ${immutable && zone ? 'cursor-not-allowed bg-muted/60' : ''}`}
        name={name}
        type={type}
        min={type === 'number' ? 0 : undefined}
        defaultValue={value}
        required={!['governorate', 'freeDeliveryAt'].includes(name)}
        readOnly={Boolean(immutable && zone)}
      />
    </label>
  ));
}

export default async function StorefrontSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:products');
  const sp = await searchParams;
  const t = await getTranslations('storefrontAdmin');
  const zones = await prisma.storefrontDeliveryZone.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
  const labels = {
    code: t('code'), nameEn: t('nameEn'), nameAr: t('nameAr'), governorate: t('governorate'),
    deliveryFee: t('deliveryFee'), minimumOrder: t('minimumOrder'), freeDeliveryAt: t('freeDeliveryAt'), sortOrder: t('sortOrder'),
  };
  const result = typeof sp.result === 'string' ? sp.result : null;

  return (
    <>
      <BackLink href="/admin/records" label={t('back')} />
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {result ? (
        <p className={`rounded-lg border px-3 py-2 text-sm font-semibold ${result === 'saved' ? 'border-success/25 bg-success-soft text-success' : 'border-danger/25 bg-danger-soft text-danger'}`}>
          {t(`result.${result}`)}
        </p>
      ) : null}

      <section className="grid gap-3">
        <h2 className="text-base font-semibold text-foreground">{t('zones')}</h2>
        {zones.map((zone) => (
          <form key={zone.id} action={updateDeliveryZone.bind(null, zone.id)} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="locale" value={locale} />
            <ZoneFields labels={labels} zone={zone} />
            <div className="flex flex-wrap items-center gap-2 border-t pt-3 sm:col-span-2 lg:col-span-4">
              <button className="min-h-10 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" type="submit">{t('save')}</button>
              <button
                className="min-h-10 rounded-lg border px-4 py-2 text-sm font-semibold text-foreground"
                formAction={setDeliveryZoneActive.bind(null, zone.id, !zone.isActive, locale)}
                type="submit"
              >
                {zone.isActive ? t('archive') : t('restore')}
              </button>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${zone.isActive ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground'}`}>
                {zone.isActive ? t('active') : t('inactive')}
              </span>
            </div>
          </form>
        ))}
        {!zones.length ? <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{t('empty')}</p> : null}
      </section>

      <section className="grid gap-3 rounded-lg border bg-card p-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">{t('addZone')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('addZoneHint')}</p>
        </div>
        <form action={createDeliveryZone} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="locale" value={locale} />
          <ZoneFields labels={labels} />
          <div className="border-t pt-3 sm:col-span-2 lg:col-span-4">
            <button className="min-h-10 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" type="submit">{t('add')}</button>
          </div>
        </form>
      </section>
    </>
  );
}
