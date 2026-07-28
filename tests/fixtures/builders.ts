import type {
  OrderLike,
  OrderLineWithProduct,
  ProductLite,
  InventoryItemLike,
  MovementLike,
} from '@/lib/metrics/types';

let seq = 0;

export function makeProduct(over: Partial<ProductLite> = {}): ProductLite {
  seq += 1;
  return {
    id: `p${seq}`,
    sku: `LH-ESP-TEST-250-WB`,
    nameEn: `Product ${seq}`,
    nameAr: `منتج ${seq}`,
    productLine: 'ESPRESSO',
    grind: 'WHOLE_BEAN',
    sizeLabel: '250g',
    ...over,
  };
}

export function makeOrder(over: Partial<OrderLike> = {}): OrderLike {
  seq += 1;
  return {
    id: `o${seq}`,
    placedAt: new Date('2026-05-15T10:00:00.000Z'),
    status: 'COMPLETED',
    channel: 'ONLINE_STORE',
    governorate: 'BAGHDAD',
    customerId: `c${seq}`,
    currency: 'IQD',
    grossAmount: 0,
    discountAmount: 0,
    refundAmount: 0,
    deliveryFee: 0,
    extraCharges: 0,
    deliveryCost: 0,
    ...over,
  };
}

export function makeLine(over: Partial<OrderLineWithProduct> = {}): OrderLineWithProduct {
  const product = over.product ?? makeProduct();
  const quantity = over.quantity ?? 1;
  const unitGrossPrice = over.unitGrossPrice ?? 10000;
  const lineDiscount = over.lineDiscount ?? 0;
  return {
    productId: product.id,
    sku: product.sku,
    quantity,
    unitGrossPrice,
    lineDiscount,
    lineNet: over.lineNet ?? unitGrossPrice * quantity - lineDiscount,
    unitCogsSnapshot: over.unitCogsSnapshot ?? 6000,
    product,
  };
}

export function makeMovement(over: Partial<MovementLike> = {}): MovementLike {
  return {
    occurredAt: new Date('2026-05-01T00:00:00.000Z'),
    reason: 'PURCHASE',
    quantity: 0,
    expiryDate: null,
    ...over,
  };
}

export function makeItem(over: Partial<InventoryItemLike> = {}): InventoryItemLike {
  seq += 1;
  return {
    id: `i${seq}`,
    category: 'GREEN_COFFEE',
    nameEn: `Item ${seq}`,
    nameAr: `صنف ${seq}`,
    unit: 'g',
    reorderPoint: null,
    avgDailyUsage: null,
    unitCost: null,
    movements: [],
    ...over,
  };
}
