import 'server-only';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';

export interface ProductLabelData {
  id: string;
  locale: AppLocale;
  mainName: string;
  variationName: string;
  specItems: { label: string; value: string }[];
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
    ? { weight: 'الوزن', pack: 'العبوة', size: 'الحجم', grind: 'الطحن', roast: 'التحميص', origin: 'المنشأ', unit: 'الوحدة' }
    : { weight: 'Weight', pack: 'Pack', size: 'Size', grind: 'Grind', roast: 'Roast', origin: 'Origin', unit: 'Unit' };
  const gramUnit = locale === 'ar' ? 'غ' : 'g';
  const unitLabels: Record<string, { en: string; ar: string }> = {
    g: { en: 'g', ar: 'غ' },
    kg: { en: 'kg', ar: 'كغم' },
    lb: { en: 'lb', ar: 'رطل' },
    ml: { en: 'ml', ar: 'مل' },
    l: { en: 'l', ar: 'لتر' },
    unit: { en: 'unit', ar: 'وحدة' },
    piece: { en: 'piece', ar: 'قطعة' },
    sachet: { en: 'sachet', ar: 'ظرف' },
    pack: { en: 'pack', ar: 'عبوة' },
    box: { en: 'box', ar: 'علبة' },
    bag: { en: 'bag', ar: 'كيس' },
    carton: { en: 'carton', ar: 'كرتون' },
  };
  const rawSize = product.sizeLabel?.trim();
  const packageCount = product.sku.match(/(?:^|-)(\d+)PCS(?:-|$)/i)?.[1] ?? null;
  const sizeItem = packageCount
    ? {
        label: labels.pack,
        value: locale === 'ar' ? `${packageCount} قطع` : `${packageCount} pieces`,
      }
    : product.sizeGrams
      ? { label: labels.weight, value: `${product.sizeGrams} ${gramUnit}` }
      : rawSize && rawSize !== '—'
        ? {
            label: /^\d+(?:[.,]\d+)?$/.test(rawSize) ? labels.weight : labels.size,
            value: /^\d+(?:[.,]\d+)?$/.test(rawSize) ? `${rawSize} ${gramUnit}` : rawSize,
          }
        : null;
  const specItems = [
    sizeItem,
    product.grind && product.grind !== 'NONE'
      ? { label: labels.grind, value: enumLabel(product.grind, locale) }
      : null,
    product.roastLevel ? { label: labels.roast, value: enumLabel(product.roastLevel, locale) } : null,
    product.origin ? { label: labels.origin, value: product.origin } : null,
    product.sellUnit && product.sellUnit !== 'unit'
      ? {
          label: labels.unit,
          value: unitLabels[product.sellUnit]?.[locale] ?? product.sellUnit,
        }
      : null,
  ].filter((value): value is { label: string; value: string } => Boolean(value));
  const separator = locale === 'ar' ? '  •  ' : '  •  ';
  const details = specItems.map((item) => `${item.label}: ${item.value}`);
  const specLines = [details.slice(0, 2).join(separator), details.slice(2).join(separator)].filter(Boolean);
  const variationName = product.invoiceName?.trim() || productName;

  return {
    id: product.id,
    locale,
    mainName: groupName || productName,
    variationName: variationName === (groupName || productName) ? '' : variationName,
    specItems,
    specLines,
    retailBarcode: product.retailBarcode,
  };
}
