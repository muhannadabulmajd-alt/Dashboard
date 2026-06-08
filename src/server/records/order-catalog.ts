import 'server-only';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';
import type { CatalogItem } from '@/components/records/OrderForm';

/**
 * Active sellable variations for the order line picker, grouped by parent
 * product (BRD §11–12). `name` carries the full variation identity; `group`
 * is the parent group name (or the supplied "ungrouped" label).
 */
export async function getOrderCatalog(locale: string, ungroupedLabel: string): Promise<CatalogItem[]> {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { sku: 'asc' },
    include: { group: { select: { nameEn: true, nameAr: true } } },
  });
  return products.map((p) => ({
    sku: p.sku,
    name: `${locale === 'ar' ? p.nameAr : p.nameEn} — ${p.sizeLabel} · ${enumLabel(p.grind, locale as AppLocale)}`,
    group: p.group ? (locale === 'ar' ? p.group.nameAr : p.group.nameEn) : ungroupedLabel,
    price: p.sellingPrice,
  }));
}
