import 'server-only';
import { prisma } from '@/server/db/client';
import { enumLabel } from '@/lib/enums';
import type { AppLocale } from '@/lib/money';

export interface ProductLabelData {
  id: string;
  mainName: string;
  variationName: string;
  specs: string;
  barcodeValue: string;
}

export async function getProductLabelData(id: string, locale: AppLocale): Promise<ProductLabelData | null> {
  const product = await prisma.product.findUnique({
    where: { id },
    include: { group: true },
  });
  if (!product) return null;

  const productName = locale === 'ar' ? product.nameAr : product.nameEn;
  const groupName = product.group ? (locale === 'ar' ? product.group.nameAr : product.group.nameEn) : null;
  const specs = [
    product.sizeLabel && product.sizeLabel !== '—' ? product.sizeLabel : null,
    product.sizeGrams ? `${product.sizeGrams}g` : null,
    product.grind && product.grind !== 'NONE' ? enumLabel(product.grind, locale) : null,
    product.roastLevel ? enumLabel(product.roastLevel, locale) : null,
    product.origin,
    product.sellUnit && product.sellUnit !== 'unit' ? product.sellUnit : null,
  ]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .join(' · ');

  return {
    id: product.id,
    mainName: groupName || productName,
    variationName: product.invoiceName || productName,
    specs,
    barcodeValue: product.barcodeValue,
  };
}
