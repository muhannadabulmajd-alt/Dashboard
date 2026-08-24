import { createHash } from 'node:crypto';
import { z } from 'zod';

export const storefrontQuoteSchema = z.object({
  lines: z.array(z.object({
    sku: z.string().trim().min(1),
    quantity: z.coerce.number().int().min(1).max(999),
  })).min(1).max(100),
  deliveryZoneCode: z.string().trim().min(1).optional(),
});

export type StorefrontQuoteInput = z.infer<typeof storefrontQuoteSchema>;

const checkoutCustomerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(7).max(40),
  email: z.string().trim().email().optional().or(z.literal('')),
  governorate: z.string().trim().min(1).max(80),
  address1: z.string().trim().max(300).optional(),
  street: z.string().trim().max(300).optional(),
});

export const storefrontCheckoutSchema = storefrontQuoteSchema.extend({
  quoteHash: z.string().regex(/^[a-f\d]{64}$/i),
  paymentMode: z.enum(['WAYL', 'COD']),
  locale: z.enum(['ar', 'en']).default('ar'),
  customer: checkoutCustomerSchema,
});

export type StorefrontCheckoutInput = z.infer<typeof storefrontCheckoutSchema>;

export const storefrontDeliveryZoneInputSchema = z.object({
  code: z.string().trim().min(2).max(32).regex(/^[A-Za-z0-9_-]+$/),
  nameEn: z.string().trim().min(1).max(100),
  nameAr: z.string().trim().min(1).max(100),
  governorate: z.string().trim().max(80).optional(),
  deliveryFee: z.coerce.number().int().nonnegative(),
  minimumOrder: z.coerce.number().int().nonnegative(),
  freeDeliveryAt: z.coerce.number().int().positive().optional(),
  sortOrder: z.coerce.number().int().min(0).max(999),
});

export const storefrontOrderLookupSchema = z.object({
  orderNumber: z.string().trim().min(6).max(80),
  phone: z.string().trim().min(7).max(40),
});

export function storefrontBearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer\s+([A-Za-z0-9_-]{32,200})$/i);
  return match?.[1] ?? null;
}

export function validIdempotencyKey(value: string | null): string | null {
  const key = value?.trim() ?? '';
  return /^[A-Za-z0-9._:-]{16,160}$/.test(key) ? key : null;
}

export function classifyWaylStatus(value: string): 'PAID' | 'PENDING' | 'FAILED' | 'RETURNED' | 'UNKNOWN' {
  switch (value.trim().toUpperCase()) {
    case 'COMPLETE':
    case 'DELIVERED':
      return 'PAID';
    case 'CREATED':
    case 'PENDING':
    case 'PROCESSING':
      return 'PENDING';
    case 'CANCELLED':
    case 'CANCELED':
    case 'REJECTED':
      return 'FAILED';
    case 'RETURNED':
      return 'RETURNED';
    default:
      return 'UNKNOWN';
  }
}

export function checkoutEventKey(rawBody: string): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

export function waylWebhookEventDisposition(status: string | null): 'retry' | 'duplicate' | 'new' {
  if (!status) return 'new';
  return status === 'FAILED' ? 'retry' : 'duplicate';
}

function nestedString(payload: Record<string, unknown>, key: string): string | null {
  const direct = payload[key];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const data = payload.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function waylWebhookReference(payload: Record<string, unknown>): string | null {
  return nestedString(payload, 'referenceId');
}

export function waylWebhookStatus(payload: Record<string, unknown>): string | null {
  return nestedString(payload, 'status');
}
