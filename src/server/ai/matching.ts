import 'server-only';
import { normalizeAssistantText } from '@/lib/ai-assistant';
import { normalizeIraqiPhone } from '@/lib/phone';
import { prisma } from '@/server/db/client';
import { matchActiveProduct } from '@/server/products/matching';

export type MatchResult<T> =
  | { kind: 'exact'; value: T }
  | { kind: 'ambiguous'; candidates: T[] }
  | { kind: 'none'; candidates: T[] };

export async function matchCustomer(query: string) {
  const normalizedPhone = normalizeIraqiPhone(query);
  const normalizedQuery = normalizeAssistantText(query);
  const rows = await prisma.customer.findMany({
    where: { isActive: true },
    select: { id: true, externalId: true, nameEn: true, nameAr: true, phone: true, normalizedPhone: true },
    orderBy: { createdAt: 'desc' },
  });
  const exact = rows.filter((row) =>
    (normalizedPhone && row.normalizedPhone === normalizedPhone) ||
    normalizeAssistantText(row.externalId ?? '') === normalizedQuery ||
    normalizeAssistantText(row.nameEn ?? '') === normalizedQuery ||
    normalizeAssistantText(row.nameAr ?? '') === normalizedQuery,
  );
  if (exact.length === 1) return { kind: 'exact', value: exact[0] } as const;
  if (exact.length > 1) return { kind: 'ambiguous', candidates: exact } as const;
  const fuzzy = rows.filter((row) =>
    [row.externalId, row.nameEn, row.nameAr, row.phone]
      .filter(Boolean)
      .some((value) => normalizeAssistantText(value ?? '').includes(normalizedQuery)),
  ).slice(0, 8);
  return fuzzy.length
    ? { kind: 'ambiguous', candidates: fuzzy } as const
    : { kind: 'none', candidates: [] } as const;
}

export async function matchProduct(query: string) {
  return matchActiveProduct(query);
}

export async function matchOrder(query: string, scope: { branchId?: string } = {}) {
  const normalized = normalizeAssistantText(query);
  const rows = await prisma.order.findMany({
    where: {
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      OR: [
        { id: query },
        { orderNumber: { contains: query, mode: 'insensitive' } },
        { customer: { externalId: { contains: query, mode: 'insensitive' } } },
      ],
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      placedAt: true,
      grossAmount: true,
      discountAmount: true,
      refundAmount: true,
      deliveryFee: true,
      extraCharges: true,
      channel: true,
      fulfillmentMethod: true,
      customer: { select: { nameEn: true, nameAr: true, externalId: true } },
    },
    orderBy: { placedAt: 'desc' },
    take: 12,
  });
  const exact = rows.filter((row) =>
    row.id === query || normalizeAssistantText(row.orderNumber) === normalized,
  );
  if (exact.length === 1) return { kind: 'exact', value: exact[0] } as const;
  return rows.length
    ? { kind: 'ambiguous', candidates: rows } as const
    : { kind: 'none', candidates: [] } as const;
}

export async function matchFinanceAccount(query: string) {
  const normalized = normalizeAssistantText(query);
  const rows = await prisma.financeAccount.findMany({
    where: { isActive: true, currency: 'IQD', type: { not: 'PAYMENT_GATEWAY' } },
    select: { id: true, name: true, externalKey: true, currency: true, type: true },
    orderBy: { name: 'asc' },
  });
  const exact = rows.filter((row) =>
    row.id === query ||
    normalizeAssistantText(row.name) === normalized ||
    normalizeAssistantText(row.externalKey ?? '') === normalized,
  );
  if (exact.length === 1) return { kind: 'exact', value: exact[0] } as const;
  const candidates = exact.length > 1
    ? exact
    : rows.filter((row) => normalizeAssistantText(row.name).includes(normalized)).slice(0, 8);
  return candidates.length
    ? { kind: 'ambiguous', candidates } as const
    : { kind: 'none', candidates: [] } as const;
}

export async function matchParty(query: string, type?: 'SUPPLIER' | 'CUSTOMER') {
  const normalized = normalizeAssistantText(query);
  const normalizedPhone = normalizeIraqiPhone(query);
  const rows = await prisma.party.findMany({
    where: { isActive: true, ...(type ? { type } : {}) },
    select: {
      id: true,
      name: true,
      type: true,
      externalKey: true,
      phone: true,
      collectsOrderPayments: true,
      defaultSettlementAccountId: true,
    },
    orderBy: { name: 'asc' },
  });
  const exact = rows.filter((row) =>
    row.id === query ||
    (normalizedPhone && normalizeIraqiPhone(row.phone) === normalizedPhone) ||
    normalizeAssistantText(row.name) === normalized ||
    normalizeAssistantText(row.externalKey ?? '') === normalized,
  );
  if (exact.length === 1) return { kind: 'exact', value: exact[0] } as const;
  const candidates = exact.length > 1
    ? exact
    : rows.filter((row) => normalizeAssistantText(row.name).includes(normalized)).slice(0, 8);
  return candidates.length
    ? { kind: 'ambiguous', candidates } as const
    : { kind: 'none', candidates: [] } as const;
}

export async function matchInventoryItem(query: string, scope: { branchId?: string } = {}) {
  const normalized = normalizeAssistantText(query);
  const rows = await prisma.inventoryItem.findMany({
    where: { isActive: true, ...(scope.branchId ? { branchId: scope.branchId } : {}) },
    select: { id: true, nameEn: true, nameAr: true, category: true, unit: true, branchId: true },
    orderBy: { nameEn: 'asc' },
  });
  const names = (row: typeof rows[number]) => [row.nameEn, row.nameAr].map(normalizeAssistantText);
  const exact = rows.filter((row) => row.id === query || names(row).includes(normalized));
  if (exact.length === 1) return { kind: 'exact', value: exact[0] } as const;
  const candidates = exact.length > 1
    ? exact
    : rows.filter((row) => names(row).some((name) => name.includes(normalized))).slice(0, 8);
  return candidates.length
    ? { kind: 'ambiguous', candidates } as const
    : { kind: 'none', candidates: [] } as const;
}
