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
    }>;
  } = {},
) {
  return prisma.$transaction(async (tx) => {
    await options.beforeExecute?.(tx);
    const customer = await createCustomerInTransaction(tx, rawInput, context);
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
