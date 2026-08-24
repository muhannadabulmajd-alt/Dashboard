import 'server-only';
import { prisma } from '@/server/db/client';
import { effectivePrice } from '@/lib/metrics/pricing';
import { sha256Hex } from './auth';
import { storefrontQuoteSchema, type StorefrontQuoteInput } from './contracts';

export { storefrontQuoteSchema } from './contracts';
export type { StorefrontQuoteInput } from './contracts';

export type StorefrontLocale = 'en' | 'ar';

export type StorefrontVariation = {
  slug: string;
  sku: string;
  nameEn: string;
  nameAr: string;
  imageUrl: string | null;
  price: number;
  currency: 'IQD';
  sizeLabel: string;
  sizeGrams: number | null;
  grind: string;
  roastLevel: string | null;
  origin: string | null;
  sellUnit: string;
  availableQuantity: number | null;
  allowBackorder: boolean;
  available: boolean;
};

export type StorefrontProduct = {
  slug: string;
  code: string;
  nameEn: string;
  nameAr: string;
  description: string | null;
  imageUrl: string | null;
  productLine: string;
  variations: StorefrontVariation[];
};

export type StorefrontDeliveryZoneDto = {
  code: string;
  nameEn: string;
  nameAr: string;
  governorate: string | null;
  deliveryFee: number;
  minimumOrder: number;
  freeDeliveryAt: number | null;
};

export class StorefrontCatalogError extends Error {
  constructor(
    readonly code: 'invalid_product' | 'unavailable' | 'delivery_zone' | 'minimum_order',
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'StorefrontCatalogError';
  }
}

async function inventoryByProduct(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const items = await prisma.inventoryItem.findMany({
    where: { isActive: true, productId: { in: productIds } },
    select: { id: true, productId: true },
  });
  if (items.length === 0) return new Map();
  const totals = await prisma.stockMovement.groupBy({
    by: ['inventoryItemId'],
    where: { inventoryItemId: { in: items.map((item) => item.id) } },
    _sum: { quantity: true },
  });
  const byItem = new Map(totals.map((row) => [row.inventoryItemId, Number(row._sum.quantity ?? 0)]));
  const byProduct = new Map<string, number>();
  for (const item of items) {
    if (!item.productId) continue;
    byProduct.set(item.productId, (byProduct.get(item.productId) ?? 0) + (byItem.get(item.id) ?? 0));
  }
  return byProduct;
}

async function loadPublishedProducts() {
  const products = await prisma.product.findMany({
    where: { isActive: true, storefrontPublished: true, storefrontSlug: { not: null } },
    include: {
      group: true,
      prices: {
        where: { kind: 'BASE' },
        select: { kind: true, price: true, effectiveFrom: true },
      },
    },
    orderBy: [{ group: { code: 'asc' } }, { sku: 'asc' }],
  });
  const inventory = await inventoryByProduct(products.map((product) => product.id));
  const now = new Date();
  return products.map((product) => {
    const rawAvailable = inventory.get(product.id) ?? 0;
    const availableQuantity = product.trackInventory ? Math.max(0, Math.floor(rawAvailable)) : null;
    return {
      product,
      variation: {
        slug: product.storefrontSlug!,
        sku: product.sku,
        nameEn: product.nameEn,
        nameAr: product.nameAr,
        imageUrl: product.imageUrl ?? product.group?.imageUrl ?? null,
        price: effectivePrice(product.prices, product.sellingPrice, now),
        currency: 'IQD' as const,
        sizeLabel: product.sizeLabel,
        sizeGrams: product.sizeGrams,
        grind: product.grind,
        roastLevel: product.roastLevel,
        origin: product.origin,
        sellUnit: product.sellUnit,
        availableQuantity,
        allowBackorder: product.allowBackorder,
        available: !product.trackInventory || product.allowBackorder || (availableQuantity ?? 0) > 0,
      } satisfies StorefrontVariation,
    };
  });
}

export async function getStorefrontCatalog() {
  const [rows, zones] = await Promise.all([
    loadPublishedProducts(),
    prisma.storefrontDeliveryZone.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    }),
  ]);
  const grouped = new Map<string, StorefrontProduct>();
  for (const { product, variation } of rows) {
    const group = product.group?.storefrontPublished && product.group.storefrontSlug
      ? product.group
      : null;
    const key = group?.id ?? product.id;
    const existing = grouped.get(key);
    if (existing) {
      existing.variations.push(variation);
      continue;
    }
    grouped.set(key, {
      slug: group?.storefrontSlug ?? variation.slug,
      code: group?.code ?? product.sku,
      nameEn: group?.nameEn ?? product.nameEn,
      nameAr: group?.nameAr ?? product.nameAr,
      description: group?.description ?? null,
      imageUrl: group?.imageUrl ?? variation.imageUrl,
      productLine: product.productLine,
      variations: [variation],
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    currency: 'IQD' as const,
    products: [...grouped.values()],
    deliveryZones: zones.map((zone) => ({
      code: zone.code,
      nameEn: zone.nameEn,
      nameAr: zone.nameAr,
      governorate: zone.governorate,
      deliveryFee: zone.deliveryFee,
      minimumOrder: zone.minimumOrder,
      freeDeliveryAt: zone.freeDeliveryAt,
    })) satisfies StorefrontDeliveryZoneDto[],
  };
}

export async function getStorefrontProduct(slug: string): Promise<StorefrontProduct | null> {
  const catalog = await getStorefrontCatalog();
  return catalog.products.find((product) =>
    product.slug === slug || product.variations.some((variation) => variation.slug === slug),
  ) ?? null;
}

export async function quoteStorefrontOrder(rawInput: StorefrontQuoteInput) {
  const input = storefrontQuoteSchema.parse(rawInput);
  const catalog = await getStorefrontCatalog();
  const variationBySku = new Map(
    catalog.products.flatMap((product) => product.variations.map((variation) => [variation.sku, variation] as const)),
  );
  const lines = input.lines.map((line) => {
    const variation = variationBySku.get(line.sku);
    if (!variation) throw new StorefrontCatalogError('invalid_product', { sku: line.sku });
    if (
      variation.availableQuantity != null &&
      line.quantity > variation.availableQuantity &&
      !variation.allowBackorder
    ) {
      throw new StorefrontCatalogError('unavailable', {
        sku: line.sku,
        availableQuantity: variation.availableQuantity,
      });
    }
    return {
      sku: variation.sku,
      nameEn: variation.nameEn,
      nameAr: variation.nameAr,
      quantity: line.quantity,
      unitPrice: variation.price,
      lineTotal: variation.price * line.quantity,
      sellUnit: variation.sellUnit,
      backordered: variation.availableQuantity != null && line.quantity > variation.availableQuantity,
    };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const zone = input.deliveryZoneCode
    ? catalog.deliveryZones.find((candidate) => candidate.code === input.deliveryZoneCode)
    : null;
  if (input.deliveryZoneCode && !zone) throw new StorefrontCatalogError('delivery_zone');
  if (zone && subtotal < zone.minimumOrder) {
    throw new StorefrontCatalogError('minimum_order', { minimumOrder: zone.minimumOrder });
  }
  const deliveryFee = zone
    ? (zone.freeDeliveryAt != null && subtotal >= zone.freeDeliveryAt ? 0 : zone.deliveryFee)
    : 0;
  const total = subtotal + deliveryFee;
  const quoteHash = sha256Hex(JSON.stringify({
    lines: lines.map(({ sku, quantity, unitPrice }) => ({ sku, quantity, unitPrice })),
    deliveryZoneCode: zone?.code ?? null,
    deliveryFee,
    total,
  }));
  return {
    currency: 'IQD' as const,
    lines,
    subtotal,
    discountAmount: 0,
    deliveryFee,
    total,
    deliveryZone: zone ?? null,
    quoteHash,
    quotedAt: new Date().toISOString(),
  };
}
