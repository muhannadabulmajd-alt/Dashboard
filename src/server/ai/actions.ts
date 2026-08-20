import 'server-only';
import type { AiPendingActionType, Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/session';
import { can } from '@/lib/rbac';
import type { AppLocale } from '@/lib/money';
import { prisma } from '@/server/db/client';
import { createCustomerCommand } from '@/server/commands/customers';
import { createCentralRecordCommand } from '@/server/finance/central-records';
import { bulkUpdateOrders, createOrderCommand } from '@/server/records/orders';
import { aiDebugId, preconditionHash } from './hash';
import { actionPreconditionIssues, loadActionPreconditions } from './preconditions';
import {
  ACTION_DATA_SCHEMAS,
  ResolvedCustomerActionSchema,
  ResolvedExpenseActionSchema,
  ResolvedOrderActionSchema,
  ResolvedOrderStatusActionSchema,
  ResolvedPurchaseActionSchema,
} from './action-data';

const STALE_EXECUTION_CODES = new Set([
  'action_stale',
  'product_inactive',
  'stock_not_configured',
  'stock_configuration_ambiguous',
  'stock_insufficient',
]);

export type ActionExecutionResult = {
  actionId: string;
  status: string;
  message: string;
  href?: string;
  invoiceHref?: string;
  recordId?: string;
  replayed?: boolean;
};

type ExecutionRecord = {
  recordType: string;
  recordId: string;
  href: string;
  invoiceHref?: string;
  message: string;
};

function localized(locale: AppLocale, en: string, ar: string): string {
  return locale === 'ar' ? ar : en;
}

function formData(values: Record<string, string | number | null | undefined>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined) fd.set(key, String(value));
  }
  return fd;
}

function executionResult(input: {
  actionId: string;
  record: ExecutionRecord;
}): ActionExecutionResult {
  return {
    actionId: input.actionId,
    status: 'EXECUTED',
    message: input.record.message,
    href: input.record.href,
    invoiceHref: input.record.invoiceHref,
    recordId: input.record.recordId,
  };
}

async function completePendingAction(
  tx: Prisma.TransactionClient,
  input: {
    actionId: string;
    userId: string;
    conversationId: string;
    actionType: AiPendingActionType;
    executionKey: string;
    debugId: string;
    record: ExecutionRecord;
  },
) {
  const result = executionResult({ actionId: input.actionId, record: input.record });
  const stored = { ...result, executionKey: input.executionKey };
  const completed = await tx.aiPendingAction.updateMany({
    where: { id: input.actionId, userId: input.userId, status: 'EXECUTING' },
    data: {
      status: 'EXECUTED',
      executedAt: new Date(),
      recordType: input.record.recordType,
      recordId: input.record.recordId,
      result: stored as Prisma.InputJsonValue,
      errorCode: null,
      debugId: input.debugId,
    },
  });
  if (completed.count !== 1) throw new Error('action_claim_lost');
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: 'AI_ACTION_EXECUTED',
      entity: input.record.recordType,
      entityId: input.record.recordId,
      metadata: {
        pendingActionId: input.actionId,
        conversationId: input.conversationId,
        actionType: input.actionType,
        executionKey: input.executionKey,
        debugId: input.debugId,
      },
    },
  });
  await tx.aiMessage.create({
    data: {
      conversationId: input.conversationId,
      role: 'ASSISTANT',
      kind: 'SUCCESS',
      content: input.record.message,
      payload: { actionResult: result } as Prisma.InputJsonValue,
    },
  });
  await tx.aiConversation.update({
    where: { id: input.conversationId },
    data: { lastMessageAt: new Date() },
  });
}

async function executeCustomer(
  raw: unknown,
  user: CurrentUser,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const input = ResolvedCustomerActionSchema.parse(raw);
  let record: ExecutionRecord | null = null;
  const customer = await createCustomerCommand(
    input,
    { actorId: user.id, source: 'ai-assistant' },
    { beforeExecute, onCommitted: async (tx, customerRow) => {
      record = {
        recordType: 'Customer',
        recordId: customerRow.id,
        href: `/admin/records/customers/${customerRow.id}`,
        message: localized(locale, `Customer ${customerRow.externalId} was created.`, `تم إنشاء العميل ${customerRow.externalId}.`),
      };
      await onCommitted(tx, record);
    } },
  );
  return record ?? {
    recordType: 'Customer',
    recordId: customer.id,
    href: `/admin/records/customers/${customer.id}`,
    message: localized(locale, `Customer ${customer.externalId} was created.`, `تم إنشاء العميل ${customer.externalId}.`),
  };
}

async function executeOrder(
  raw: unknown,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const input = ResolvedOrderActionSchema.parse(raw);
  const fd = formData({
    locale,
    placedAt: input.placedAt,
    customerExternalId: input.customerExternalId,
    newCustomer: input.newCustomer ? JSON.stringify(input.newCustomer) : null,
    channel: input.channel,
    governorate: input.governorate,
    fulfillmentMethod: input.fulfillmentMethod,
    status: input.status,
    deliveryFee: input.deliveryFee,
    deliveryCost: input.deliveryCost,
    orderDiscount: input.orderDiscount,
    extraCharges: input.extraCharges,
    notes: input.notes,
    financeMode: input.financeMode,
    financeAccountId: input.financeAccountId,
    financeProviderId: input.financeProviderId,
    financePaidAmount: input.financePaidAmount,
    financePaymentMethod: input.financePaymentMethod,
    financePaymentDate: input.financePaymentDate,
    financeDueDate: input.financeDueDate,
    lines: JSON.stringify(input.lines.map(({ sku, quantity, unitGrossPrice, lineDiscount }) => ({ sku, quantity, unitGrossPrice, lineDiscount }))),
  });
  let record: ExecutionRecord | null = null;
  const result = await createOrderCommand(fd, {
    beforeExecute,
    onCommitted: async (tx, commandResult) => {
      record = {
        recordType: 'Order',
        recordId: commandResult.recordId,
        href: `/admin/records/orders/${commandResult.recordId}`,
        invoiceHref: `/invoice/${commandResult.recordId}`,
        message: localized(locale, `Order ${commandResult.recordNumber} was created.`, `تم إنشاء الطلب ${commandResult.recordNumber}.`),
      };
      await onCommitted(tx, record);
    },
  });
  if (!result?.ok || !result.recordId) throw new Error(result?.error || 'order_create_failed');
  return record ?? {
    recordType: 'Order',
    recordId: result.recordId,
    href: `/admin/records/orders/${result.recordId}`,
    invoiceHref: `/invoice/${result.recordId}`,
    message: localized(locale, `Order ${result.recordNumber} was created.`, `تم إنشاء الطلب ${result.recordNumber}.`),
  };
}

async function executeExpense(
  raw: unknown,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const input = ResolvedExpenseActionSchema.parse(raw);
  const fd = formData({
    locale,
    recordKind: 'MONEY_OUT',
    date: input.date,
    amount: input.amount,
    currency: input.currency,
    rate: input.rate,
    accountId: input.accountId,
    categoryType: input.categoryType,
    partyId: input.partyId,
    description: input.description,
    reference: input.reference,
    branchId: input.branchId,
  });
  let record: ExecutionRecord | null = null;
  const result = await createCentralRecordCommand(fd, {
    beforeExecute,
    onCommitted: async (tx, commandResult) => {
      record = {
        recordType: 'FinanceEntry',
        recordId: commandResult.recordId,
        href: `/finance/ledger/${commandResult.recordId}`,
        message: localized(locale, 'The expense was recorded.', 'تم تسجيل المصروف.'),
      };
      await onCommitted(tx, record);
    },
  });
  if (!result?.ok || !result.recordId) throw new Error(result?.error || 'expense_create_failed');
  return record ?? {
    recordType: 'FinanceEntry',
    recordId: result.recordId,
    href: `/finance/ledger/${result.recordId}`,
    message: localized(locale, 'The expense was recorded.', 'تم تسجيل المصروف.'),
  };
}

async function executePurchase(
  raw: unknown,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const input = ResolvedPurchaseActionSchema.parse(raw);
  const isInventory = input.purchaseType === 'INVENTORY';
  const fd = formData({
    locale,
    recordKind: isInventory ? 'STOCK_PURCHASE' : 'ASSET_PURCHASE',
    date: input.date,
    amount: input.totalAmount,
    currency: input.currency,
    rate: input.rate,
    quantity: input.quantity,
    unit: input.unit,
    inventoryItemMode: input.inventoryItemId ? 'existing' : 'new',
    inventoryItemId: input.inventoryItemId,
    newItemNameEn: input.newItemNameEn,
    newItemNameAr: input.newItemNameAr,
    newItemCategory: input.newItemCategory,
    assetName: input.assetName,
    assetCategory: input.assetCategory,
    partyId: input.supplierId,
    paymentMode: input.paidMode,
    paidAmount: input.paidAmount,
    accountId: input.accountId,
    paymentMethod: input.paymentMethod,
    paymentDate: input.paymentDate,
    dueDate: input.dueDate,
    branchId: input.branchId,
    reference: input.reference,
    description: input.notes || (isInventory ? input.newItemNameEn : input.assetName),
  });
  let record: ExecutionRecord | null = null;
  const result = await createCentralRecordCommand(fd, {
    beforeExecute,
    onCommitted: async (tx, commandResult) => {
      record = {
        recordType: 'FinanceEntry',
        recordId: commandResult.recordId,
        href: `/finance/ledger/${commandResult.recordId}`,
        message: localized(locale, 'The purchase was recorded and linked records were synchronized.', 'تم تسجيل الشراء ومزامنة السجلات المرتبطة.'),
      };
      await onCommitted(tx, record);
    },
  });
  if (!result?.ok || !result.recordId) throw new Error(result?.error || 'purchase_create_failed');
  return record ?? {
    recordType: 'FinanceEntry',
    recordId: result.recordId,
    href: `/finance/ledger/${result.recordId}`,
    message: localized(locale, 'The purchase was recorded and linked records were synchronized.', 'تم تسجيل الشراء ومزامنة السجلات المرتبطة.'),
  };
}

async function executeOrderStatus(
  raw: unknown,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const input = ResolvedOrderStatusActionSchema.parse(raw);
  const fd = formData({
    orderIds: JSON.stringify([input.orderId]),
    operation: 'STATUS',
    status: input.status,
    completionMode: input.completionMode,
    accountId: input.accountId,
    providerKey: input.providerKey,
    paymentMethod: input.paymentMethod,
    date: input.date,
  });
  const record: ExecutionRecord = {
    recordType: 'Order',
    recordId: input.orderId,
    href: `/admin/records/orders/${input.orderId}`,
    message: localized(locale, `Order ${input.orderNumber} is now ${input.status}.`, `أصبحت حالة الطلب ${input.orderNumber}: ${input.status}.`),
  };
  const result = await bulkUpdateOrders(undefined, fd, {
    beforeExecute,
    onCommitted: (tx) => onCommitted(tx, record),
  });
  if (!result?.ok) throw new Error(result?.error || 'order_status_failed');
  return record;
}

async function executeByType(
  type: AiPendingActionType,
  raw: unknown,
  user: CurrentUser,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  ACTION_DATA_SCHEMAS[type].parse(raw);
  switch (type) {
    case 'CREATE_CUSTOMER':
      return executeCustomer(raw, user, locale, beforeExecute, onCommitted);
    case 'CREATE_ORDER':
      return executeOrder(raw, locale, beforeExecute, onCommitted);
    case 'CREATE_EXPENSE':
      return executeExpense(raw, locale, beforeExecute, onCommitted);
    case 'CREATE_PURCHASE':
      return executePurchase(raw, locale, beforeExecute, onCommitted);
    case 'UPDATE_ORDER_STATUS':
      return executeOrderStatus(raw, locale, beforeExecute, onCommitted);
  }
}

async function markActionStale(input: {
  actionId: string;
  userId: string;
  locale: AppLocale;
  issues: Array<{ field: string; code: string; detail?: string }>;
  fromStatus: 'PENDING' | 'EXECUTING';
}) {
  await prisma.$transaction(async (tx) => {
    const action = await tx.aiPendingAction.findFirst({
      where: { id: input.actionId, userId: input.userId },
      select: { preview: true },
    });
    if (!action) return;
    const preview = action.preview as Record<string, unknown>;
    const oldWarnings = Array.isArray(preview.warnings) ? preview.warnings.map(String) : [];
    const changed = await tx.aiPendingAction.updateMany({
      where: { id: input.actionId, userId: input.userId, status: input.fromStatus },
      data: {
        status: 'STALE',
        errorCode: 'preconditions_changed',
        preview: {
          ...preview,
          warnings: [
            ...oldWarnings,
            localized(input.locale, 'Atlas data changed after this preview. Prepare the action again to review fresh values.', 'تغيرت بيانات أطلس بعد إعداد المعاينة. أعد إعداد الإجراء لمراجعة القيم الجديدة.'),
            ...input.issues.map((issue) => issue.code),
          ],
        } as Prisma.InputJsonValue,
      },
    });
    if (changed.count === 1) {
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: 'AI_ACTION_STALE',
          entity: 'AiPendingAction',
          entityId: input.actionId,
          metadata: { issues: input.issues },
        },
      });
    }
  });
}

export async function confirmPendingAction(input: {
  actionId: string;
  user: CurrentUser;
  locale: AppLocale;
}): Promise<ActionExecutionResult> {
  if (!can(input.user.role, 'use:ai-assistant')) throw new Error('forbidden');
  const action = await prisma.aiPendingAction.findFirst({
    where: { id: input.actionId, userId: input.user.id },
  });
  if (!action) throw new Error('notfound');
  if (action.status === 'EXECUTED') {
    const result = action.result as Record<string, unknown> | null;
    return {
      actionId: action.id,
      status: action.status,
      message: String(result?.message ?? localized(input.locale, 'This action was already completed.', 'تم تنفيذ هذا الإجراء مسبقاً.')),
      href: typeof result?.href === 'string' ? result.href : undefined,
      invoiceHref: typeof result?.invoiceHref === 'string' ? result.invoiceHref : undefined,
      recordId: action.recordId ?? undefined,
      replayed: true,
    };
  }
  if (action.status === 'EXECUTING') {
    const staleClaim = action.updatedAt.getTime() <= Date.now() - 2 * 60_000;
    if (!staleClaim) throw new Error('action_in_progress');
    const recovered = await prisma.aiPendingAction.updateMany({
      where: {
        id: action.id,
        userId: input.user.id,
        status: 'EXECUTING',
        updatedAt: action.updatedAt,
      },
      data: { status: 'PENDING', errorCode: 'execution_interrupted' },
    });
    if (recovered.count === 1) return confirmPendingAction(input);
    const latest = await prisma.aiPendingAction.findUnique({ where: { id: action.id } });
    if (latest?.status === 'EXECUTED') return confirmPendingAction(input);
    throw new Error('action_in_progress');
  }
  if (action.status !== 'PENDING') throw new Error(`action_${action.status.toLowerCase()}`);
  if (action.expiresAt <= new Date()) {
    await prisma.$transaction(async (tx) => {
      const expired = await tx.aiPendingAction.updateMany({
        where: { id: action.id, userId: input.user.id, status: 'PENDING' },
        data: { status: 'EXPIRED', errorCode: 'expired' },
      });
      if (expired.count === 1) {
        await tx.auditLog.create({
          data: {
            userId: input.user.id,
            action: 'AI_ACTION_EXPIRED',
            entity: 'AiPendingAction',
            entityId: action.id,
            metadata: { actionType: action.type },
          },
        });
      }
    });
    throw new Error('action_expired');
  }
  if (!action.validatedData) throw new Error('action_invalid');

  const currentPreconditions = await loadActionPreconditions(action.type, action.validatedData);
  const currentIssues = actionPreconditionIssues(action.type, action.validatedData, currentPreconditions);
  if (currentIssues.length || preconditionHash(currentPreconditions) !== action.preconditionHash) {
    await markActionStale({
      actionId: action.id,
      userId: input.user.id,
      locale: input.locale,
      issues: currentIssues,
      fromStatus: 'PENDING',
    });
    throw new Error('action_stale');
  }

  const claimed = await prisma.$transaction(async (tx) => {
    const updated = await tx.aiPendingAction.updateMany({
      where: { id: action.id, userId: input.user.id, status: 'PENDING' },
      data: { status: 'EXECUTING' },
    });
    if (updated.count === 1) {
      await tx.auditLog.create({
        data: {
          userId: input.user.id,
          action: 'AI_ACTION_CONFIRMED',
          entity: 'AiPendingAction',
          entityId: action.id,
          metadata: {
            conversationId: action.conversationId,
            actionType: action.type,
            executionKey: action.executionKey,
          },
        },
      });
    }
    return updated;
  });
  if (claimed.count !== 1) {
    const latest = await prisma.aiPendingAction.findUnique({ where: { id: action.id } });
    if (latest?.status === 'EXECUTED') return confirmPendingAction(input);
    throw new Error('action_in_progress');
  }

  const debugId = aiDebugId('ai-action');
  try {
    const beforeExecute = async (tx: Prisma.TransactionClient) => {
      const fresh = await loadActionPreconditions(action.type, action.validatedData, tx, { lock: true });
      const issues = actionPreconditionIssues(action.type, action.validatedData, fresh);
      if (issues.length || preconditionHash(fresh) !== action.preconditionHash) {
        throw new Error('action_stale');
      }
    };
    const result = await executeByType(
      action.type,
      action.validatedData,
      input.user,
      input.locale,
      beforeExecute,
      (tx, record) => completePendingAction(tx, {
        actionId: action.id,
        userId: input.user.id,
        conversationId: action.conversationId,
        actionType: action.type,
        executionKey: action.executionKey,
        debugId,
        record,
      }),
    );
    return executionResult({ actionId: action.id, record: result });
  } catch (error) {
    const latest = await prisma.aiPendingAction.findUnique({ where: { id: action.id } });
    if (latest?.status === 'EXECUTED' && latest.result) {
      const stored = latest.result as Record<string, unknown>;
      return {
        actionId: latest.id,
        status: latest.status,
        message: String(stored.message ?? localized(input.locale, 'The action was completed.', 'تم تنفيذ الإجراء.')),
        href: typeof stored.href === 'string' ? stored.href : undefined,
        invoiceHref: typeof stored.invoiceHref === 'string' ? stored.invoiceHref : undefined,
        recordId: latest.recordId ?? undefined,
        replayed: true,
      };
    }
    const rawCode = error instanceof Error ? error.message.slice(0, 120) : 'execution_failed';
    const code = rawCode.split(':')[0];
    if (STALE_EXECUTION_CODES.has(code)) {
      await markActionStale({
        actionId: action.id,
        userId: input.user.id,
        locale: input.locale,
        issues: [{ field: 'action', code }],
        fromStatus: 'EXECUTING',
      });
      throw new Error('action_stale');
    }
    await prisma.$transaction(async (tx) => {
      const failed = await tx.aiPendingAction.updateMany({
        where: { id: action.id, userId: input.user.id, status: 'EXECUTING' },
        data: { status: 'FAILED', errorCode: code, debugId },
      });
      if (failed.count === 1) {
        await tx.auditLog.create({
          data: {
            userId: input.user.id,
            action: 'AI_ACTION_FAILED',
            entity: 'AiPendingAction',
            entityId: action.id,
            metadata: { actionType: action.type, errorCode: code, debugId },
          },
        });
      }
    });
    throw new Error(`action_failed:${debugId}`);
  }
}

export async function cancelPendingAction(input: { actionId: string; user: CurrentUser; locale: AppLocale }): Promise<ActionExecutionResult> {
  if (!can(input.user.role, 'use:ai-assistant')) throw new Error('forbidden');
  const result = {
    actionId: input.actionId,
    status: 'CANCELLED',
    message: localized(input.locale, 'The proposed action was cancelled. No data was changed.', 'تم إلغاء الإجراء المقترح ولم تتغير أي بيانات.'),
  };
  await prisma.$transaction(async (tx) => {
    const action = await tx.aiPendingAction.findFirst({
      where: { id: input.actionId, userId: input.user.id },
      select: { conversationId: true },
    });
    if (!action) throw new Error('notfound');
    const cancelled = await tx.aiPendingAction.updateMany({
      where: { id: input.actionId, userId: input.user.id, status: 'PENDING' },
      data: { status: 'CANCELLED', result: { reason: 'user_cancelled' } },
    });
    if (cancelled.count !== 1) throw new Error('action_not_pending');
    await tx.auditLog.create({
      data: {
        userId: input.user.id,
        action: 'AI_ACTION_CANCELLED',
        entity: 'AiPendingAction',
        entityId: input.actionId,
        metadata: { source: 'ai-assistant' },
      },
    });
    await tx.aiMessage.create({
      data: {
        conversationId: action.conversationId,
        role: 'ASSISTANT',
        kind: 'SUCCESS',
        content: result.message,
        payload: { actionResult: result } as Prisma.InputJsonValue,
      },
    });
    await tx.aiConversation.update({
      where: { id: action.conversationId },
      data: { lastMessageAt: new Date() },
    });
  });
  return result;
}
