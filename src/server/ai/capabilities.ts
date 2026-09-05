import 'server-only';

import type { AiPendingActionType, Prisma } from '@prisma/client';
import {
  AI_CAPABILITIES,
  AiCapabilityUpdateSchema,
  aiCapabilitiesForAction,
  aiCapabilityForTool,
  defaultAiCapabilityState,
  type AiCapability,
  type AiCapabilityState,
  type AiCapabilityUpdate,
} from '@/lib/ai-capabilities';
import type { CurrentUser } from '@/server/auth/session';
import { prisma } from '@/server/db/client';
import { assistantToolsForRole } from './access';

type CapabilityDb = Prisma.TransactionClient | typeof prisma;

function stateFromRow(
  capability: AiCapability,
  row: {
    status: 'ENABLED' | 'DISABLED' | 'PAUSED';
    failureCount: number;
    failureLimit: number;
    disabledReason: string | null;
    lastFailureAt: Date | null;
    updatedAt: Date;
  } | undefined,
): AiCapabilityState {
  if (!row) return defaultAiCapabilityState(capability);
  return {
    capability,
    status: row.status,
    failureCount: row.failureCount,
    failureLimit: row.failureLimit,
    disabledReason: row.disabledReason,
    lastFailureAt: row.lastFailureAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function capabilityRows(capabilities: readonly AiCapability[], db: CapabilityDb) {
  if (!capabilities.length) return [];
  return db.aiCapabilitySetting.findMany({
    where: { capability: { in: [...capabilities] } },
    select: {
      capability: true,
      status: true,
      failureCount: true,
      failureLimit: true,
      disabledReason: true,
      lastFailureAt: true,
      updatedAt: true,
    },
  });
}

export async function getAiCapabilityStates(db: CapabilityDb = prisma): Promise<AiCapabilityState[]> {
  const rows = await capabilityRows(AI_CAPABILITIES, db);
  const byCapability = new Map(rows.map((row) => [row.capability, row]));
  return AI_CAPABILITIES.map((capability) => stateFromRow(capability, byCapability.get(capability)));
}

export async function isAiCapabilityEnabled(
  capability: AiCapability,
  db: CapabilityDb = prisma,
): Promise<boolean> {
  const row = await db.aiCapabilitySetting.findUnique({
    where: { capability },
    select: { status: true },
  });
  return !row || row.status === 'ENABLED';
}

export async function assertAiCapabilityEnabled(
  capability: AiCapability,
  db: CapabilityDb = prisma,
): Promise<void> {
  if (!await isAiCapabilityEnabled(capability, db)) {
    throw new Error(`ai_capability_unavailable:${capability}`);
  }
}

export async function assertAiToolCapabilityEnabled(toolName: string, db: CapabilityDb = prisma): Promise<void> {
  const capability = aiCapabilityForTool(toolName);
  if (!capability) throw new Error('ai_tool_forbidden');
  await assertAiCapabilityEnabled(capability, db);
}

export async function assertAiActionCapabilitiesEnabled(
  actionType: AiPendingActionType,
  db: CapabilityDb = prisma,
): Promise<void> {
  const capabilities = aiCapabilitiesForAction(actionType);
  if (!capabilities.length) throw new Error('ai_action_forbidden');
  const rows = await capabilityRows(capabilities, db);
  const status = new Map(rows.map((row) => [row.capability, row.status]));
  const unavailable = capabilities.find((capability) => {
    const current = status.get(capability);
    return current !== undefined && current !== 'ENABLED';
  });
  if (unavailable) throw new Error(`ai_capability_unavailable:${unavailable}`);
}

export async function enabledAssistantToolsForRole(role: CurrentUser['role']) {
  const allowed = assistantToolsForRole(role);
  const capabilities = [...new Set(allowed.flatMap((tool) => {
    const capability = aiCapabilityForTool(tool.name);
    return capability ? [capability] : [];
  }))];
  const rows = await capabilityRows(capabilities, prisma);
  const unavailable = new Set(rows.filter((row) => row.status !== 'ENABLED').map((row) => row.capability));
  return allowed.filter((tool) => {
    const capability = aiCapabilityForTool(tool.name);
    return Boolean(capability && !unavailable.has(capability));
  });
}

function safeFailureCode(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'operation_failed';
}

export async function recordAiCapabilityFailure(input: {
  capability: AiCapability;
  userId: string;
  errorCode: string;
}): Promise<AiCapabilityState> {
  const now = new Date();
  const errorCode = safeFailureCode(input.errorCode);
  return prisma.$transaction(async (tx) => {
    const row = await tx.aiCapabilitySetting.upsert({
      where: { capability: input.capability },
      create: {
        capability: input.capability,
        failureCount: 1,
        lastFailureAt: now,
      },
      update: {
        failureCount: { increment: 1 },
        lastFailureAt: now,
      },
    });
    const shouldPause = row.status === 'ENABLED' && row.failureCount >= row.failureLimit;
    if (shouldPause) {
      const paused = await tx.aiCapabilitySetting.updateMany({
        where: { capability: input.capability, status: 'ENABLED' },
        data: {
          status: 'PAUSED',
          disabledReason: `automatic:${errorCode}`,
          updatedById: null,
        },
      });
      if (paused.count === 1) {
        await tx.auditLog.create({
          data: {
            userId: input.userId,
            action: 'AI_CAPABILITY_AUTO_PAUSED',
            entity: 'AiCapabilitySetting',
            entityId: input.capability,
            metadata: { errorCode, failureCount: row.failureCount, failureLimit: row.failureLimit },
          },
        });
      }
    }
    const latest = await tx.aiCapabilitySetting.findUniqueOrThrow({ where: { capability: input.capability } });
    return stateFromRow(input.capability, latest);
  });
}

export async function recordAiCapabilitySuccess(capability: AiCapability): Promise<void> {
  await prisma.aiCapabilitySetting.updateMany({
    where: { capability, status: 'ENABLED', failureCount: { gt: 0 } },
    data: { failureCount: 0, lastFailureAt: null },
  });
}

export async function updateAiCapabilitySetting(input: {
  user: CurrentUser;
  value: AiCapabilityUpdate;
}): Promise<AiCapabilityState> {
  if (input.user.role !== 'OWNER') throw new Error('forbidden');
  const value = AiCapabilityUpdateSchema.parse(input.value);
  return prisma.$transaction(async (tx) => {
    const row = await tx.aiCapabilitySetting.upsert({
      where: { capability: value.capability },
      create: {
        capability: value.capability,
        status: value.status,
        failureLimit: value.failureLimit,
        failureCount: 0,
        disabledReason: value.status === 'ENABLED' ? null : value.reason ?? 'manual',
        lastFailureAt: null,
        updatedById: input.user.id,
      },
      update: {
        status: value.status,
        failureLimit: value.failureLimit,
        failureCount: 0,
        disabledReason: value.status === 'ENABLED' ? null : value.reason ?? 'manual',
        lastFailureAt: null,
        updatedById: input.user.id,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: input.user.id,
        action: 'AI_CAPABILITY_UPDATED',
        entity: 'AiCapabilitySetting',
        entityId: value.capability,
        metadata: { status: value.status, failureLimit: value.failureLimit },
      },
    });
    return stateFromRow(value.capability, row);
  });
}
