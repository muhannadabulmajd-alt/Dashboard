import 'server-only';
import { effectivePrice } from '@/lib/metrics/pricing';
import { rankProductCandidates } from '@/lib/product-matching';
import { prisma } from '@/server/db/client';

async function matchProduct(query: string, activeOnly: boolean) {
  const now = new Date();
  const productRows = await prisma.product.findMany({
    where: activeOnly ? { isActive: true } : {},
    select: {
      id: true,
      sku: true,
      barcodeValue: true,
      retailBarcode: true,
      nameEn: true,
      nameAr: true,
      aliases: true,
      sizeGrams: true,
      sizeLabel: true,
      grind: true,
      roastLevel: true,
      origin: true,
      productLine: true,
      variationType: true,
      sellUnit: true,
      sellingPrice: true,
      cogsPerUnit: true,
      prices: { where: { kind: 'BASE' }, select: { kind: true, price: true, effectiveFrom: true } },
      group: { select: { code: true, nameEn: true, nameAr: true } },
    },
    orderBy: { sku: 'asc' },
  });
  const rows = productRows.map(({ prices, ...row }) => ({
    ...row,
    sellingPrice: effectivePrice(prices, row.sellingPrice, now),
  }));
  return rankProductCandidates(rows, query);
}

/** Resolve a sellable product by SKU, barcode, bilingual name, alias, or specs. */
export async function matchActiveProduct(query: string) {
  return matchProduct(query, true);
}

/** Resolve current or archived products for historical reporting. */
export async function matchReportingProduct(query: string) {
  return matchProduct(query, false);
}

export type ActiveProductMatch = Awaited<ReturnType<typeof matchActiveProduct>>;
