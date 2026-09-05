import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_CAPABILITIES,
  AiCapabilityUpdateSchema,
  aiCapabilitiesForAction,
  aiCapabilityForTool,
  type AiCapability,
} from '@/lib/ai-capabilities';

type Row = {
  capability: string;
  status: 'ENABLED' | 'DISABLED' | 'PAUSED';
  failureCount: number;
  failureLimit: number;
  disabledReason: string | null;
  lastFailureAt: Date | null;
  updatedById: string | null;
  updatedAt: Date;
};

const database = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  audits: [] as Array<Record<string, unknown>>,
}));

function freshRow(capability: string, change: Partial<Row> = {}): Row {
  return {
    capability,
    status: 'ENABLED',
    failureCount: 0,
    failureLimit: 1,
    disabledReason: null,
    lastFailureAt: null,
    updatedById: null,
    updatedAt: new Date('2026-09-05T12:00:00.000Z'),
    ...change,
  };
}

vi.mock('@/server/db/client', () => {
  const aiCapabilitySetting = {
    findMany: vi.fn(async (input: { where?: { capability?: { in?: string[] } } }) => {
      const requested = input.where?.capability?.in;
      return [...database.rows.values()].filter((row) => !requested || requested.includes(row.capability));
    }),
    findUnique: vi.fn(async (input: { where: { capability: string } }) => (
      database.rows.get(input.where.capability) ?? null
    )),
    findUniqueOrThrow: vi.fn(async (input: { where: { capability: string } }) => {
      const row = database.rows.get(input.where.capability);
      if (!row) throw new Error('notfound');
      return row;
    }),
    upsert: vi.fn(async (input: {
      where: { capability: string };
      create: Partial<Row> & { capability: string };
      update: Partial<Row> & { failureCount?: number | { increment: number } };
    }) => {
      const existing = database.rows.get(input.where.capability);
      const base = existing ?? freshRow(input.where.capability);
      const change = existing ? input.update : input.create;
      const failureCount = typeof change.failureCount === 'object'
        ? base.failureCount + change.failureCount.increment
        : change.failureCount ?? base.failureCount;
      const next = freshRow(input.where.capability, { ...base, ...change, failureCount, updatedAt: new Date() });
      database.rows.set(next.capability, next);
      return next;
    }),
    updateMany: vi.fn(async (input: {
      where: { capability: string; status?: string; failureCount?: { gt: number } };
      data: Partial<Row>;
    }) => {
      const row = database.rows.get(input.where.capability);
      if (!row) return { count: 0 };
      if (input.where.status && row.status !== input.where.status) return { count: 0 };
      if (input.where.failureCount && row.failureCount <= input.where.failureCount.gt) return { count: 0 };
      database.rows.set(row.capability, freshRow(row.capability, { ...row, ...input.data, updatedAt: new Date() }));
      return { count: 1 };
    }),
  };
  const auditLog = {
    create: vi.fn(async (input: { data: Record<string, unknown> }) => {
      database.audits.push(input.data);
      return input.data;
    }),
  };
  const prisma = {
    aiCapabilitySetting,
    auditLog,
    $transaction: vi.fn(async (callback: (tx: { aiCapabilitySetting: typeof aiCapabilitySetting; auditLog: typeof auditLog }) => Promise<unknown>) => (
      callback({ aiCapabilitySetting, auditLog })
    )),
  };
  return { prisma };
});

import {
  assertAiActionCapabilitiesEnabled,
  enabledAssistantToolsForRole,
  getAiCapabilityStates,
  recordAiCapabilityFailure,
  recordAiCapabilitySuccess,
  updateAiCapabilitySetting,
} from '@/server/ai/capabilities';
import { pendingActionError } from '@/server/ai/action-http';

const owner = {
  id: 'owner-1',
  email: 'owner@example.com',
  name: 'Owner',
  role: 'OWNER' as const,
  branchId: null,
  defaultFinanceAccountId: null,
};

afterEach(() => {
  database.rows.clear();
  database.audits.length = 0;
  vi.clearAllMocks();
});

describe('AI capability release controls', () => {
  it('keeps the phase mapping explicit and the update contract strict', () => {
    expect(aiCapabilityForTool('product_buyers')).toBe('READS');
    expect(aiCapabilityForTool('prepare_create_order')).toBe('ORDERS_CUSTOMERS');
    expect(aiCapabilityForTool('arbitrary_sql')).toBeNull();
    expect(aiCapabilitiesForAction('CREATE_EXPENSE')).toEqual(['SPENDING_PURCHASES']);
    expect(AiCapabilityUpdateSchema.parse({
      capability: 'READS',
      status: 'ENABLED',
      failureLimit: 2,
      reason: null,
    })).toMatchObject({ capability: 'READS', failureLimit: 2 });
    expect(() => AiCapabilityUpdateSchema.parse({
      capability: 'READS', status: 'ENABLED', failureLimit: 0, sql: 'select *',
    })).toThrow();
  });

  it('treats missing database rows as enabled without writing defaults', async () => {
    const states = await getAiCapabilityStates();
    expect(states).toHaveLength(AI_CAPABILITIES.length);
    expect(states.every((state) => state.status === 'ENABLED' && state.failureCount === 0)).toBe(true);
    expect(database.rows.size).toBe(0);
  });

  it('removes paused tools before the model sees them while retaining unrelated role tools', async () => {
    database.rows.set('READS', freshRow('READS', { status: 'PAUSED' }));
    const tools = await enabledAssistantToolsForRole('OWNER');
    expect(tools.some((tool) => tool.name === 'sales_summary')).toBe(false);
    expect(tools.some((tool) => tool.name === 'prepare_create_order')).toBe(true);
  });

  it('rechecks the mapped capability before action execution', async () => {
    database.rows.set('ORDERS_CUSTOMERS', freshRow('ORDERS_CUSTOMERS', { status: 'DISABLED' }));
    await expect(assertAiActionCapabilitiesEnabled('CREATE_ORDER'))
      .rejects.toThrow('ai_capability_unavailable:ORDERS_CUSTOMERS');
    await expect(assertAiActionCapabilitiesEnabled('CREATE_EXPENSE')).resolves.toBeUndefined();
    expect(pendingActionError(new Error('ai_capability_unavailable:ORDERS_CUSTOMERS'), 'en'))
      .toMatchObject({ status: 503, body: { error: 'ai_capability_unavailable', retryable: true } });
  });

  it('auto-pauses only after the configured mutation failure threshold and records an audit', async () => {
    database.rows.set('ORDERS_CUSTOMERS', freshRow('ORDERS_CUSTOMERS', { failureLimit: 2 }));
    const first = await recordAiCapabilityFailure({
      capability: 'ORDERS_CUSTOMERS', userId: owner.id, errorCode: 'order_commit_failed',
    });
    expect(first).toMatchObject({ status: 'ENABLED', failureCount: 1, failureLimit: 2 });
    const second = await recordAiCapabilityFailure({
      capability: 'ORDERS_CUSTOMERS', userId: owner.id, errorCode: 'order_commit_failed',
    });
    expect(second).toMatchObject({ status: 'PAUSED', failureCount: 2 });
    expect(database.audits).toContainEqual(expect.objectContaining({ action: 'AI_CAPABILITY_AUTO_PAUSED' }));
    expect(database.rows.get('READS')).toBeUndefined();
  });

  it('resets recovered failures and permits only an Owner to change controls', async () => {
    database.rows.set('SPENDING_PURCHASES', freshRow('SPENDING_PURCHASES', { failureCount: 1, failureLimit: 3 }));
    await recordAiCapabilitySuccess('SPENDING_PURCHASES');
    expect(database.rows.get('SPENDING_PURCHASES')?.failureCount).toBe(0);

    const updated = await updateAiCapabilitySetting({
      user: owner,
      value: { capability: 'SPENDING_PURCHASES', status: 'ENABLED', failureLimit: 3, reason: null },
    });
    expect(updated).toMatchObject({ status: 'ENABLED', failureCount: 0, disabledReason: null });
    await expect(updateAiCapabilitySetting({
      user: { ...owner, role: 'ADMIN' },
      value: { capability: 'READS', status: 'DISABLED', failureLimit: 1, reason: 'test' },
    })).rejects.toThrow('forbidden');
  });
});
