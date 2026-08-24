import { getTranslations } from 'next-intl/server';
import { Package, Users, ShoppingBag, Boxes, Flame, ChevronRight, ListChecks, Building2, Store } from 'lucide-react';
import { getPageContext } from '@/server/page-context';
import { can, type Capability } from '@/lib/rbac';
import { Link } from '@/i18n/navigation';
import { PageHeader } from '@/components/ui/primitives';
import { SectionGuide } from '@/components/records/SectionGuide';

// Products and Product Groups are merged into one "Products & Variations"
// section (BRD §3): main products lead, their variations live inside.
const ENTITIES: { key: string; href: string; cap: Capability; Icon: typeof Package }[] = [
  { key: 'productsVariations', href: '/admin/records/products', cap: 'manage:products', Icon: Package },
  { key: 'orders', href: '/admin/records/orders', cap: 'manage:orders', Icon: ShoppingBag },
  { key: 'customers', href: '/admin/records/customers', cap: 'manage:customers', Icon: Users },
  { key: 'inventory', href: '/admin/records/inventory', cap: 'manage:inventory', Icon: Boxes },
  { key: 'batches', href: '/admin/records/batches', cap: 'manage:batches', Icon: Flame },
  { key: 'branches', href: '/admin/branches', cap: 'manage:branches', Icon: Building2 },
  { key: 'storefront', href: '/admin/records/storefront', cap: 'manage:products', Icon: Store },
  { key: 'systemLists', href: '/admin/records/system-lists', cap: 'view:records', Icon: ListChecks },
];

export default async function RecordsHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await getPageContext(params, searchParams, 'view:records');
  const t = await getTranslations('records');
  const visible = ENTITIES.filter((e) => can(user.role, e.cap));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <SectionGuide title={t('guide.hub.title')} intro={t('guide.hub.intro')} points={t.raw('guide.hub.points') as string[]} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map(({ key, href, Icon }) => (
          <Link
            key={key}
            href={href}
            className="group flex min-h-28 items-start gap-3 rounded-[var(--radius)] border bg-card p-4 shadow-sm hover:border-primary"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">{t(`entities.${key}`)}</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">{t(`entityHints.${key}`)}</div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180 group-hover:text-primary" />
          </Link>
        ))}
      </div>
    </>
  );
}
