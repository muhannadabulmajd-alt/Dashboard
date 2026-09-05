import 'server-only';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { CUSTOMER_SEGMENTS } from '@/lib/enums';
import { normalizeIraqiPhone } from '@/lib/phone';
import { prisma } from '@/server/db/client';
import { generateCustomerExternalId } from '@/server/records/numbering';
import type { CommandCommitHook, CommandPreconditionHook } from '@/server/records/shared';

export const CustomerCommandSchema = z.object({
  nameEn: z.string().trim().optional(),
  nameAr: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
  governorate: z.string().trim().optional(),
  address1: z.string().trim().optional(),
  street: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  segment: z.enum(CUSTOMER_SEGMENTS).default('NEW'),
  campaignSource: z.string().trim().optional(),
}).strict().refine((data) => Boolean(data.nameEn || data.nameAr || data.phone), {
  message: 'A customer name or phone is required.',
  path: ['nameEn'],
});

export type CustomerCommandInput = z.infer<typeof CustomerCommandSchema>;

export const CustomerOrderEnrichmentSchema = z.object({
  nameEn: z.string().trim().optional(),
  nameAr: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
  governorate: z.string().trim().optional(),
  address1: z.string().trim().optional(),
  street: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  campaignSource: z.string().trim().optional(),
  segment: z.enum(CUSTOMER_SEGMENTS).optional(),
}).strict();

export type CustomerOrderEnrichmentInput = z.infer<typeof CustomerOrderEnrichmentSchema>;

export const CustomerUpdateCommandSchema = z.object({
  customerId: z.string().min(1),
  nameEn: z.string().trim().nullable().optional(),
  nameAr: z.string().trim().nullable().optional(),
  phone: z.string().trim().nullable().optional(),
  email: z.string().trim().email().nullable().optional().or(z.literal('')),
  governorate: z.string().trim().nullable().optional(),
  address1: z.string().trim().nullable().optional(),
  street: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  segment: z.enum(CUSTOMER_SEGMENTS).optional(),
  campaignSource: z.string().trim().nullable().optional(),
  reason: z.string().trim().min(3),
}).strict().refine((data) => Object.keys(data).some((key) => !['customerId', 'reason'].includes(key)), {
  message: 'At least one customer field must be supplied.',
  path: ['customerId'],
});

export type CustomerUpdateCommandInput = z.infer<typeof CustomerUpdateCommandSchema>;

type CustomerMatchCandidate = {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
};

export function normalizeCustomerName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ar-IQ')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function compatibleCustomerMatches(
  input: Pick<CustomerCommandInput, 'nameEn' | 'nameAr'>,
  candidates: CustomerMatchCandidate[],
): CustomerMatchCandidate[] {
  const suppliedNames = [input.nameEn, input.nameAr].map(normalizeCustomerName).filter(Boolean);
  if (!suppliedNames.length) return candidates;
  return candidates.filter((candidate) => {
    const existingNames = [candidate.nameEn, candidate.nameAr].map(normalizeCustomerName).filter(Boolean);
    return !existingNames.length || suppliedNames.some((name) => existingNames.includes(name));
  });
}

async function enrichCompatibleCustomer(
  tx: Prisma.TransactionClient,
  customer: {
    id: string;
    externalId: string | null;
    nameEn: string | null;
    nameAr: string | null;
    phone: string | null;
    normalizedPhone: string | null;
    email: string | null;
    governorate: string | null;
    address1: string | null;
    street: string | null;
    notes: string | null;
    campaignSource: string | null;
  },
  input: CustomerCommandInput,
  context: { actorId: string; source: string },
) {
  const fillOnly = {
    ...(!customer.nameEn && input.nameEn ? { nameEn: input.nameEn } : {}),
    ...(!customer.nameAr && input.nameAr ? { nameAr: input.nameAr } : {}),
    ...(!customer.phone && input.phone ? { phone: input.phone } : {}),
    ...(!customer.email && input.email ? { email: input.email } : {}),
    ...(!customer.governorate && input.governorate ? { governorate: input.governorate } : {}),
    ...(!customer.address1 && input.address1 ? { address1: input.address1 } : {}),
    ...(!customer.street && input.street ? { street: input.street } : {}),
    ...(!customer.notes && input.notes ? { notes: input.notes } : {}),
    ...(!customer.campaignSource && input.campaignSource ? { campaignSource: input.campaignSource } : {}),
  };
  if (Object.keys(fillOnly).length) {
    await tx.customer.update({ where: { id: customer.id }, data: fillOnly });
    await tx.auditLog.create({
      data: {
        userId: context.actorId,
        action: 'CUSTOMER_ENRICHED',
        entity: 'Customer',
        entityId: customer.id,
        metadata: { source: context.source, fields: Object.keys(fillOnly) },
      },
    });
  }
  return {
    id: customer.id,
    externalId: customer.externalId,
    nameEn: customer.nameEn || input.nameEn || null,
    nameAr: customer.nameAr || input.nameAr || null,
    phone: customer.phone || input.phone || null,
    normalizedPhone: customer.normalizedPhone,
    reused: true as const,
  };
}

export async function createCustomerInTransaction(
  tx: Prisma.TransactionClient,
  rawInput: CustomerCommandInput,
  context: { actorId: string; source: string },
) {
  const input = CustomerCommandSchema.parse(rawInput);
  const normalizedPhone = normalizeIraqiPhone(input.phone);
  if (normalizedPhone) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-phone:${normalizedPhone}`}))`;
  }
  const externalId = await generateCustomerExternalId(tx);
  const customer = await tx.customer.create({
    data: {
      ...input,
      email: input.email || null,
      normalizedPhone,
      externalId,
    },
    select: {
      id: true,
      externalId: true,
      nameEn: true,
      nameAr: true,
      phone: true,
      normalizedPhone: true,
    },
  });
  await tx.auditLog.create({
    data: {
      userId: context.actorId,
      action: 'CREATE',
      entity: 'Customer',
      entityId: customer.id,
      metadata: { externalId, source: context.source },
    },
  });
  return customer;
}

export async function resolveOrCreateCustomerInTransaction(
  tx: Prisma.TransactionClient,
  rawInput: CustomerCommandInput,
  context: { actorId: string; source: string },
) {
  const input = CustomerCommandSchema.parse(rawInput);
  const normalizedPhone = normalizeIraqiPhone(input.phone);
  if (!normalizedPhone) {
    const created = await createCustomerInTransaction(tx, input, context);
    return { ...created, reused: false as const };
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-phone:${normalizedPhone}`}))`;
  const candidates = await tx.customer.findMany({
    where: { normalizedPhone, isActive: true },
    select: {
      id: true,
      externalId: true,
      nameEn: true,
      nameAr: true,
      phone: true,
      normalizedPhone: true,
      email: true,
      governorate: true,
      address1: true,
      street: true,
      notes: true,
      campaignSource: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const compatible = compatibleCustomerMatches(input, candidates);
  if (compatible.length > 1) throw new Error('customer_match_ambiguous');
  if (compatible.length === 1) {
    const matched = candidates.find((candidate) => candidate.id === compatible[0].id);
    if (!matched) throw new Error('customer_match_changed');
    return enrichCompatibleCustomer(tx, matched, input, context);
  }
  const created = await createCustomerInTransaction(tx, input, context);
  return { ...created, reused: false as const };
}

export async function enrichCustomerForOrderInTransaction(
  tx: Prisma.TransactionClient,
  customerId: string,
  rawInput: CustomerOrderEnrichmentInput,
  context: { actorId: string; source: string },
) {
  const input = CustomerOrderEnrichmentSchema.parse(rawInput);
  await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
  const customer = await tx.customer.findUnique({ where: { id: customerId } });
  if (!customer?.isActive) throw new Error('customer_not_found');
  if (compatibleCustomerMatches(input, [customer]).length !== 1) {
    throw new Error('customer_name_conflict');
  }

  const normalizedPhone = input.phone === undefined ? undefined : normalizeIraqiPhone(input.phone);
  if (normalizedPhone) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-phone:${normalizedPhone}`}))`;
    const samePhone = await tx.customer.findMany({
      where: { normalizedPhone, isActive: true, id: { not: customerId } },
      select: { id: true, nameEn: true, nameAr: true },
    });
    const proposedNames = {
      nameEn: input.nameEn ?? customer.nameEn ?? undefined,
      nameAr: input.nameAr ?? customer.nameAr ?? undefined,
    };
    if (compatibleCustomerMatches(proposedNames, samePhone).length) {
      throw new Error('customer_duplicate');
    }
  }

  const data: Prisma.CustomerUpdateInput = {
    ...input,
    ...(input.email === '' ? { email: null } : {}),
    ...(normalizedPhone !== undefined ? { normalizedPhone } : {}),
  };
  const updated = await tx.customer.update({ where: { id: customerId }, data });
  await tx.auditLog.create({
    data: {
      userId: context.actorId,
      action: 'CUSTOMER_ENRICHED_FROM_ORDER',
      entity: 'Customer',
      entityId: customerId,
      metadata: {
        source: context.source,
        fields: Object.keys(input),
        before: {
          nameEn: customer.nameEn,
          nameAr: customer.nameAr,
          phone: customer.phone,
          email: customer.email,
          governorate: customer.governorate,
          address1: customer.address1,
          street: customer.street,
          notes: customer.notes,
          campaignSource: customer.campaignSource,
          segment: customer.segment,
        },
      },
    },
  });
  return updated;
}

export async function createCustomerCommand(
  rawInput: CustomerCommandInput,
  context: { actorId: string; source: string },
  options: {
    beforeExecute?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<{
      id: string;
      externalId: string | null;
      nameEn: string | null;
      nameAr: string | null;
      phone: string | null;
      normalizedPhone: string | null;
      reused: boolean;
    }>;
    matchExisting?: boolean;
  } = {},
) {
  return prisma.$transaction(async (tx) => {
    await options.beforeExecute?.(tx);
    const customer = options.matchExisting
      ? await resolveOrCreateCustomerInTransaction(tx, rawInput, context)
      : { ...await createCustomerInTransaction(tx, rawInput, context), reused: false as const };
    await options.onCommitted?.(tx, customer);
    return customer;
  });
}

export async function updateCustomerCommand(
  rawInput: CustomerUpdateCommandInput,
  context: { actorId: string; source: string },
  options: {
    beforeExecute?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<{
      id: string;
      externalId: string | null;
      nameEn: string | null;
      nameAr: string | null;
      phone: string | null;
      normalizedPhone: string | null;
    }>;
  } = {},
) {
  const input = CustomerUpdateCommandSchema.parse(rawInput);
  const { customerId, reason, ...changes } = input;

  return prisma.$transaction(async (tx) => {
    await options.beforeExecute?.(tx);
    await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE`;
    const before = await tx.customer.findUnique({ where: { id: customerId } });
    if (!before || !before.isActive) throw new Error('customer_not_found');

    const normalizedPhone = changes.phone === undefined
      ? undefined
      : normalizeIraqiPhone(changes.phone);
    if (normalizedPhone) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-phone:${normalizedPhone}`}))`;
      const samePhone = await tx.customer.findMany({
        where: { normalizedPhone, isActive: true, id: { not: customerId } },
        select: { id: true, nameEn: true, nameAr: true },
      });
      const proposedNames = {
        nameEn: changes.nameEn === undefined ? before.nameEn ?? undefined : changes.nameEn ?? undefined,
        nameAr: changes.nameAr === undefined ? before.nameAr ?? undefined : changes.nameAr ?? undefined,
      };
      if (compatibleCustomerMatches(proposedNames, samePhone).length > 0) {
        throw new Error('customer_duplicate');
      }
    }

    const data: Prisma.CustomerUpdateInput = {
      ...changes,
      ...(changes.email === '' ? { email: null } : {}),
      ...(normalizedPhone !== undefined ? { normalizedPhone } : {}),
    };
    const customer = await tx.customer.update({
      where: { id: customerId },
      data,
      select: {
        id: true,
        externalId: true,
        nameEn: true,
        nameAr: true,
        phone: true,
        normalizedPhone: true,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: context.actorId,
        action: 'UPDATE',
        entity: 'Customer',
        entityId: customerId,
        metadata: {
          source: context.source,
          reason,
          before: {
            nameEn: before.nameEn,
            nameAr: before.nameAr,
            phone: before.phone,
            email: before.email,
            governorate: before.governorate,
            address1: before.address1,
            street: before.street,
            notes: before.notes,
            segment: before.segment,
            campaignSource: before.campaignSource,
          },
          after: changes,
        },
      },
    });
    await options.onCommitted?.(tx, customer);
    return customer;
  });
}

export function customerDisplayLabel(data: {
  externalId: string | null;
  nameEn: string | null;
  nameAr: string | null;
  phone: string | null;
}) {
  const name = data.nameEn || data.nameAr || data.phone || data.externalId || 'Customer';
  return data.externalId ? `${name} (${data.externalId})` : name;
}
