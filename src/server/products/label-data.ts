import 'server-only';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';

export interface ProductLabelData {
  id: string;
  locale: AppLocale;
  mainName: string;
  variationName: string;
  specLines: string[];
  retailBarcode: string;
}

export async function getProductLabelData(id: string, locale: AppLocale): Promise<ProductLabelData | null> {
  const product = await prisma.product.findUnique({
    where: { id },
    include: { group: true },
  });
  if (!product) return null;

  const productName = locale === 'ar' ? product.nameAr : product.nameEn;
  const groupName = product.group ? (locale === 'ar' ? product.group.nameAr : product.group.nameEn) : null;
  const labels = locale === 'ar'
    ? { weight: 'الوزن', grind: 'الطحن', roast: 'التحميص', origin: 'المنشأ', unit: 'الوحدة' }
    : { weight: 'Weight', grind: 'Grind', roast: 'Roast', origin: 'Origin', unit: 'Unit' };
  const gramUnit = locale === 'ar' ? 'غ' : 'g';
  const rawSize = product.sizeLabel?.trim();
  const normalizedSize = rawSize && rawSize !== '—'
    ? /^\d+(?:[.,]\d+)?$/.test(rawSize)
      ? `${rawSize} ${gramUnit}`
      : rawSize
    : product.sizeGrams
      ? `${product.sizeGrams} ${gramUnit}`
      : null;
  const details = [
    normalizedSize ? `${labels.weight}: ${normalizedSize}` : null,
    product.grind && product.grind !== 'NONE' ? `${labels.grind}: ${enumLabel(product.grind, locale)}` : null,
    product.roastLevel ? `${labels.roast}: ${enumLabel(product.roastLevel, locale)}` : null,
    product.origin ? `${labels.origin}: ${product.origin}` : null,
    product.sellUnit ? `${labels.unit}: ${enumLabel(product.sellUnit, locale)}` : null,
  ].filter((value): value is string => Boolean(value));
  const separator = locale === 'ar' ? '  •  ' : '  •  ';
  const specLines = [details.slice(0, 2).join(separator), details.slice(2).join(separator)].filter(Boolean);
  const variationName = product.invoiceName?.trim() || productName;

  return {
    id: product.id,
    locale,
    mainName: groupName || productName,
    variationName: variationName === (groupName || productName) ? '' : variationName,
    specLines,
    retailBarcode: product.retailBarcode,
  };
}
