// Lightweight structural input types for the metrics layer. They are subsets of
// the Prisma models so repository results can be passed in directly, while the
// metrics stay pure and free of any database dependency (and so unit-testable).
import type {
  OrderStatus,
  Channel,
  Governorate,
  Currency,
  ProductLine,
  Grind,
  RoastLevel,
  MovementReason,
  InventoryCategory,
  ExpenseCategoryType,
  CustomerSegment,
  ShipmentStatus,
} from '@prisma/client';

export interface OrderLike {
  id: string;
  placedAt: Date;
  status: OrderStatus;
  channel: Channel;
  governorate: Governorate;
  customerId: string | null;
  currency: Currency;
  grossAmount: number;
  discountAmount: number;
  refundAmount: number;
  deliveryFee: number;
  deliveryCost: number;
}

export interface ProductLite {
  id: string;
  sku: string;
  nameEn: string;
  nameAr: string;
  productLine: ProductLine;
  grind: Grind;
  sizeLabel: string;
}

export interface OrderLineLike {
  productId: string;
  sku: string;
  quantity: number;
  unitGrossPrice: number;
  lineDiscount: number;
  lineNet: number;
  unitCogsSnapshot: number;
}

export interface OrderLineWithProduct extends OrderLineLike {
  product: ProductLite;
}

export interface MovementLike {
  occurredAt: Date;
  reason: MovementReason;
  quantity: number; // signed: + in / - out
  expiryDate?: Date | null;
}

export interface InventoryItemLike {
  id: string;
  category: InventoryCategory;
  nameEn: string;
  nameAr: string;
  unit: string;
  reorderPoint: number | null;
  avgDailyUsage: number | null;
  unitCost: number | null;
  movements: MovementLike[];
}

export interface BatchLike {
  greenInputGrams: number;
  roastedOutputGrams: number;
  roastLevel: RoastLevel;
  roastDate: Date;
}

export interface ExpenseLike {
  amount: number;
  currency: Currency;
  incurredAt: Date;
  categoryType: ExpenseCategoryType;
}

export interface CustomerLike {
  id: string;
  governorate: Governorate | null;
  segment: CustomerSegment;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  ordersCount: number;
}

export interface ShipmentLike {
  status: ShipmentStatus;
  dispatchedAt: Date | null;
  deliveredAt: Date | null;
  shippingCost: number;
  courier: string;
  governorate: Governorate;
  placedAt: Date;
}

export interface OfferOrderLike {
  offerId: string | null;
  customerId: string | null;
  status: OrderStatus;
  grossAmount: number;
  discountAmount: number;
  refundAmount: number;
}

export interface DimensionBucket<K extends string = string> {
  key: K;
  netSales: number;
  orders: number;
  units: number;
}

export interface TimePoint {
  key: string;
  label: string;
  netSales: number;
  orders: number;
}

export interface ProductRank {
  productId: string;
  sku: string;
  name: { en: string; ar: string };
  units: number;
  netSales: number;
}

export interface ProductMarginRow extends ProductRank {
  cogs: number;
  marginAmount: number;
  marginPct: number;
}
