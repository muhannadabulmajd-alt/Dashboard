import { z } from 'zod';
import { FULFILLMENT_METHODS } from '@/lib/enums';

export const QuickOrderDraftSchema = z.object({
  conversationId: z.string().cuid().optional(),
  locale: z.enum(['ar', 'en']),
  customerExternalId: z.string().trim().min(1).nullable(),
  placedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  channel: z.string().trim().min(1),
  governorate: z.string().trim().min(1),
  fulfillmentMethod: z.enum(FULFILLMENT_METHODS),
  status: z.string().trim().min(1),
  notes: z.string().trim().max(1_000).nullable(),
  lines: z.array(z.object({
    sku: z.string().trim().min(1),
    quantity: z.number().int().min(1).max(999),
  }).strict()).min(1).max(30),
}).strict();

export type QuickOrderDraft = z.infer<typeof QuickOrderDraftSchema>;

export type QuickOrderCatalogItem = {
  sku: string;
  name: string;
  group: string;
  searchText: string;
  price: number;
  unit: string;
  barcodeValue: string;
  retailBarcode: string;
};

export type QuickOrderCustomer = {
  externalId: string;
  label: string;
  phone: string | null;
  governorate: string | null;
  recentOrder: {
    channel: string;
    governorate: string;
    fulfillmentMethod: (typeof FULFILLMENT_METHODS)[number];
  } | null;
};

export type QuickOrderOption = { value: string; label: string };

export type QuickOrderDefaults = {
  placedAt: string;
  channel: string;
  governorate: string;
  fulfillmentMethod: (typeof FULFILLMENT_METHODS)[number];
  status: string;
};
