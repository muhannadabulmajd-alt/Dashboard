import 'server-only';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { can } from '@/lib/rbac';
import { DashboardConfigSchema } from '@/lib/dashboard-builder';
import { prisma } from '@/server/db/client';
import type { CurrentUser } from '@/server/auth/session';
import type { CommandCommitHook, CommandPreconditionHook } from '@/server/records/shared';

const DashboardDraftCommandSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().nullish(),
  config: DashboardConfigSchema,
}).strict();

export type DashboardDraftCommandInput = z.input<typeof DashboardDraftCommandSchema>;

export async function createDashboardDraftCommand(
  rawInput: DashboardDraftCommandInput,
  actor: CurrentUser,
  options: {
    beforeExecute?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<{ recordId: string; name: string }>;
  } = {},
) {
  if (!can(actor.role, 'manage:dashboards')) throw new Error('forbidden');
  const input = DashboardDraftCommandSchema.parse(rawInput);
  return prisma.$transaction(async (tx) => {
    await options.beforeExecute?.(tx);
    const row = await tx.dashboard.create({
      data: {
        name: input.name,
        description: input.description || null,
        ownerId: actor.id,
        visibility: 'PRIVATE',
        config: input.config as Prisma.InputJsonValue,
        draftConfig: input.config as Prisma.InputJsonValue,
      },
      select: { id: true, name: true },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: 'AI_DASHBOARD_DRAFT_CREATED',
        entity: 'Dashboard',
        entityId: row.id,
        metadata: { source: 'ai-assistant', name: row.name },
      },
    });
    await options.onCommitted?.(tx, { recordId: row.id, name: row.name });
    return { recordId: row.id, name: row.name };
  });
}
