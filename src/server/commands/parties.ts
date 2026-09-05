import 'server-only';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { PARTY_TYPES } from '@/lib/enums';
import { normalizeIraqiPhone } from '@/lib/phone';
import { prisma } from '@/server/db/client';
import type { CommandCommitHook, CommandPreconditionHook } from '@/server/records/shared';
import { normalizeCustomerName } from './customers';

export const PartyCommandSchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(PARTY_TYPES),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
  address: z.string().trim().optional(),
  branchId: z.string().trim().optional(),
  openingPayable: z.number().int().default(0),
  openingReceivable: z.number().int().default(0),
  notes: z.string().trim().optional(),
  equityShare: z.number().min(0).max(100).optional(),
  defaultSettlementAccountId: z.string().trim().optional(),
  netFeesFromRemittance: z.boolean().default(false),
  collectsOrderPayments: z.boolean().default(false),
}).strict();

export type PartyCommandInput = z.infer<typeof PartyCommandSchema>;

export const PartyUpdateCommandSchema = PartyCommandSchema.partial().extend({
  partyId: z.string().min(1),
  reason: z.string().trim().min(3),
}).strict().refine((data) => Object.keys(data).some((key) => !['partyId', 'reason'].includes(key)), {
  message: 'At least one party field must be supplied.',
  path: ['partyId'],
});

export type PartyUpdateCommandInput = z.infer<typeof PartyUpdateCommandSchema>;

function partyMatchKey(input: Pick<PartyCommandInput, 'name' | 'phone'>) {
  return {
    name: normalizeCustomerName(input.name),
    phone: normalizeIraqiPhone(input.phone),
  };
}

async function validateRelations(
  tx: Prisma.TransactionClient,
  input: { branchId?: string | null; defaultSettlementAccountId?: string | null },
) {
  if (input.branchId) {
    const branch = await tx.branch.findUnique({ where: { id: input.branchId }, select: { isActive: true } });
    if (!branch?.isActive) throw new Error('branch_not_found');
  }
  if (input.defaultSettlementAccountId) {
    const account = await tx.financeAccount.findUnique({
      where: { id: input.defaultSettlementAccountId },
      select: { isActive: true },
    });
    if (!account?.isActive) throw new Error('account_not_found');
  }
}

export async function resolveOrCreatePartyInTransaction(
  tx: Prisma.TransactionClient,
  rawInput: PartyCommandInput,
  context: { actorId: string; source: string },
) {
  const input = PartyCommandSchema.parse(rawInput);
  const key = partyMatchKey(input);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`party:${input.type}:${key.phone || key.name}`}))`;
  const candidates = await tx.party.findMany({
    where: { type: input.type, isActive: true },
    select: { id: true, name: true, phone: true, email: true, address: true, notes: true },
    orderBy: { createdAt: 'asc' },
  });
  const compatible = candidates.filter((candidate) => {
    const candidateName = normalizeCustomerName(candidate.name);
    const candidatePhone = normalizeIraqiPhone(candidate.phone);
    return candidateName === key.name && (!key.phone || !candidatePhone || key.phone === candidatePhone);
  });
  if (compatible.length > 1) throw new Error('party_match_ambiguous');
  if (compatible.length === 1) {
    const match = compatible[0];
    const fillOnly = {
      ...(!match.phone && input.phone ? { phone: input.phone } : {}),
      ...(!match.email && input.email ? { email: input.email } : {}),
      ...(!match.address && input.address ? { address: input.address } : {}),
      ...(!match.notes && input.notes ? { notes: input.notes } : {}),
    };
    if (Object.keys(fillOnly).length) {
      await tx.party.update({ where: { id: match.id }, data: fillOnly });
      await tx.auditLog.create({
        data: {
          userId: context.actorId,
          action: 'PARTY_ENRICHED',
          entity: 'Party',
          entityId: match.id,
          metadata: { source: context.source, fields: Object.keys(fillOnly) },
        },
      });
    }
    return { id: match.id, name: match.name, reused: true as const };
  }

  await validateRelations(tx, input);
  const row = await tx.party.create({
    data: {
      ...input,
      email: input.email || null,
      branchId: input.branchId || null,
      defaultSettlementAccountId: input.defaultSettlementAccountId || null,
    },
    select: { id: true, name: true },
  });
  await tx.auditLog.create({
    data: {
      userId: context.actorId,
      action: 'CREATE',
      entity: 'Party',
      entityId: row.id,
      metadata: { source: context.source, type: input.type },
    },
  });
  return { ...row, reused: false as const };
}

export async function createPartyCommand(
  rawInput: PartyCommandInput,
  context: { actorId: string; source: string },
  options: {
    beforeExecute?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<{ id: string; name: string; reused: boolean }>;
    matchExisting?: boolean;
  } = {},
) {
  return prisma.$transaction(async (tx) => {
    await options.beforeExecute?.(tx);
    const input = PartyCommandSchema.parse(rawInput);
    const row = options.matchExisting
      ? await resolveOrCreatePartyInTransaction(tx, input, context)
      : await (async () => {
          await validateRelations(tx, input);
          const created = await tx.party.create({
            data: {
              ...input,
              email: input.email || null,
              branchId: input.branchId || null,
              defaultSettlementAccountId: input.defaultSettlementAccountId || null,
            },
            select: { id: true, name: true },
          });
          await tx.auditLog.create({
            data: {
              userId: context.actorId,
              action: 'CREATE',
              entity: 'Party',
              entityId: created.id,
              metadata: { source: context.source, type: input.type },
            },
          });
          return { ...created, reused: false as const };
        })();
    await options.onCommitted?.(tx, row);
    return row;
  });
}

export async function updatePartyCommand(
  rawInput: PartyUpdateCommandInput,
  context: { actorId: string; source: string },
  options: {
    beforeExecute?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<{ id: string; name: string }>;
  } = {},
) {
  const input = PartyUpdateCommandSchema.parse(rawInput);
  const { partyId, reason, ...changes } = input;
  return prisma.$transaction(async (tx) => {
    await options.beforeExecute?.(tx);
    await tx.$queryRaw`SELECT "id" FROM "Party" WHERE "id" = ${partyId} FOR UPDATE`;
    const before = await tx.party.findUnique({ where: { id: partyId } });
    if (!before || !before.isActive) throw new Error('party_not_found');
    await validateRelations(tx, changes);
    const row = await tx.party.update({
      where: { id: partyId },
      data: {
        ...changes,
        ...(changes.email === '' ? { email: null } : {}),
        ...(changes.branchId === '' ? { branchId: null } : {}),
        ...(changes.defaultSettlementAccountId === '' ? { defaultSettlementAccountId: null } : {}),
      },
      select: { id: true, name: true },
    });
    await tx.auditLog.create({
      data: {
        userId: context.actorId,
        action: 'UPDATE',
        entity: 'Party',
        entityId: partyId,
        metadata: { source: context.source, reason, before, after: changes },
      },
    });
    await options.onCommitted?.(tx, row);
    return row;
  });
}
