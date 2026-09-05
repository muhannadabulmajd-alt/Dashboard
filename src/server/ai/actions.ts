import 'server-only';
import type { AiPendingActionType, Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/session';
import { normalizeAssistantText } from '@/lib/ai-assistant';
import { createTrustedCommandContext } from '@/server/commands/actor-context';
import { can } from '@/lib/rbac';
import type { AppLocale } from '@/lib/money';
import { prisma } from '@/server/db/client';
import { createCustomerCommand, updateCustomerCommand } from '@/server/commands/customers';
import { updatePartyCommand } from '@/server/commands/parties';
import { createDashboardDraftCommand } from '@/server/commands/dashboards';
import { createCentralRecordFromInput } from '@/server/finance/central-records';
import { reclassifyLedgerLineFromInput } from '@/server/finance/classification';
import { reverseFinanceEntryFromInput, settleFinanceEntryFromInput } from '@/server/finance/entries';
import { adjustInventoryFromInput } from '@/server/records/inventory';
import { createRoastBatchFromInput } from '@/server/records/batches';
import {
  bulkUpdateOrdersFromInput,
  createOrderFromInput,
  recordInvoicePaymentFromInput,
  recordOrderRefundFromInput,
} from '@/server/records/orders';
import { aiDebugId, preconditionHash } from './hash';
import { canExecuteAssistantAction } from './access';
import { actionPreconditionIssues, loadActionPreconditions } from './preconditions';
import {
  ACTION_DATA_SCHEMAS,
  ResolvedCustomerActionSchema,
  ResolvedCustomerUpdateActionSchema,
  ResolvedDashboardDraftActionSchema,
  ResolvedExpenseActionSchema,
  ResolvedInventoryAdjustmentActionSchema,
  ResolvedOrderActionSchema,
  ResolvedOrderStatusActionSchema,
  ResolvedPartyUpdateActionSchema,
  ResolvedPaymentActionSchema,
  ResolvedPurchaseActionSchema,
  ResolvedRefundActionSchema,
  ResolvedReversalActionSchema,
  ResolvedRoastBatchActionSchema,
  ResolvedSpendReclassificationActionSchema,
} from './action-data';
import {
  aiDocumentHref,
  documentKindForAction,
  prepareAiDocument,
} from './documents';

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
  documentId?: string;
  documentHref?: string;
  documentStatus?: 'READY' | 'PENDING';
  receiptId?: string;
  committed?: boolean;
  recordId?: string;
  replayed?: boolean;
  requiresSecondConfirmation?: boolean;
  confirmationChallenge?: string;
};

type ExecutionRecord = {
  recordType: string;
  recordId: string;
  href: string;
  invoiceHref?: string;
  message: string;
};

type CommittedArtifact = {
  receiptId: string;
  documentId: string;
};

function localized(locale: AppLocale, en: string, ar: string): string {
  return locale === 'ar' ? ar : en;
}

async function assertAssistantChannelAccess(input: {
  user: CurrentUser;
  channel: 'WEB' | 'TELEGRAM';
  actionType?: AiPendingActionType;
}): Promise<void> {
  if (input.channel === 'WEB') {
    if (!can(input.user.role, 'use:ai-assistant')) throw new Error('forbidden');
  } else {
    const linked = await prisma.telegramIdentity.findFirst({
      where: { userId: input.user.id, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!linked) throw new Error('forbidden');
  }
  if (input.actionType && !canExecuteAssistantAction(input.user.role, input.actionType)) {
    throw new Error('forbidden');
  }
}

function executionResult(input: {
  actionId: string;
  record: ExecutionRecord;
  artifact?: CommittedArtifact;
  documentStatus?: 'READY' | 'PENDING';
  replayed?: boolean;
}): ActionExecutionResult {
  return {
    actionId: input.actionId,
    status: 'EXECUTED',
    message: input.record.message,
    href: input.record.href,
    ...(input.record.invoiceHref ? { invoiceHref: input.record.invoiceHref } : {}),
    ...(input.artifact ? {
      documentId: input.artifact.documentId,
      documentHref: aiDocumentHref(input.artifact.documentId),
      receiptId: input.artifact.receiptId,
    } : {}),
    ...(input.documentStatus ? { documentStatus: input.documentStatus } : {}),
    committed: Boolean(input.artifact),
    recordId: input.record.recordId,
    ...(input.replayed !== undefined ? { replayed: input.replayed } : {}),
  };
}

function storedExecutionResult(
  action: {
    id: string;
    status: string;
    recordId: string | null;
    result: Prisma.JsonValue | null;
    executionReceipt?: {
      id: string;
      documents: Array<{ id: string; status: string }>;
    } | null;
  },
  locale: AppLocale,
): ActionExecutionResult {
  const result = action.result && typeof action.result === 'object' && !Array.isArray(action.result)
    ? action.result as Record<string, unknown>
    : {};
  const document = action.executionReceipt?.documents[0];
  return {
    actionId: action.id,
    status: action.status,
    message: String(result.message ?? localized(locale, 'This action was already completed.', 'تم تنفيذ هذا الإجراء مسبقاً.')),
    href: typeof result.href === 'string' ? result.href : undefined,
    invoiceHref: typeof result.invoiceHref === 'string' ? result.invoiceHref : undefined,
    documentId: document?.id,
    documentHref: document ? aiDocumentHref(document.id) : undefined,
    documentStatus: document?.status === 'READY' ? 'READY' : document ? 'PENDING' : undefined,
    receiptId: action.executionReceipt?.id,
    committed: Boolean(action.executionReceipt),
    recordId: action.recordId ?? undefined,
    replayed: true,
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
    inputHash: string;
    channel: 'WEB' | 'TELEGRAM';
    deliveryDestination?: string | null;
    locale: AppLocale;
    debugId: string;
    record: ExecutionRecord;
  },
): Promise<CommittedArtifact> {
  const documentKind = documentKindForAction(input.actionType);
  const audit = await tx.auditLog.create({
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
        inputHash: input.inputHash,
        debugId: input.debugId,
        channel: input.channel,
      },
    },
    select: { id: true },
  });
  const receipt = await tx.aiExecutionReceipt.create({
    data: {
      executionKey: input.executionKey,
      pendingActionId: input.actionId,
      conversationId: input.conversationId,
      userId: input.userId,
      channel: input.channel,
      actionType: input.actionType,
      inputHash: input.inputHash,
      status: 'DOCUMENT_PENDING',
      recordType: input.record.recordType,
      recordId: input.record.recordId,
      result: {
        message: input.record.message,
        href: input.record.href,
        ...(input.record.invoiceHref ? { invoiceHref: input.record.invoiceHref } : {}),
      } as Prisma.InputJsonValue,
      linkedRecords: {
        primary: { type: input.record.recordType, id: input.record.recordId },
      } as Prisma.InputJsonValue,
      auditLogId: audit.id,
    },
    select: { id: true },
  });
  const document = await tx.aiDocument.create({
    data: {
      receiptId: receipt.id,
      conversationId: input.conversationId,
      userId: input.userId,
      kind: documentKind,
      locale: input.locale,
      recordType: input.record.recordType,
      recordId: input.record.recordId,
    },
    select: { id: true },
  });
  if (input.channel === 'TELEGRAM' && input.deliveryDestination) {
    await tx.aiDeliveryOutbox.create({
      data: {
        receiptId: receipt.id,
        documentId: document.id,
        channel: 'TELEGRAM',
        destination: input.deliveryDestination,
      },
    });
  }
  const result = executionResult({
    actionId: input.actionId,
    record: input.record,
    artifact: { receiptId: receipt.id, documentId: document.id },
    documentStatus: 'PENDING',
  });
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
  return { receiptId: receipt.id, documentId: document.id };
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
    { matchExisting: true, beforeExecute, onCommitted: async (tx, customerRow) => {
      record = {
        recordType: 'Customer',
        recordId: customerRow.id,
        href: `/admin/records/customers/${customerRow.id}`,
        message: customerRow.reused
          ? localized(locale, `Customer ${customerRow.externalId} was matched and updated safely.`, `تمت مطابقة العميل ${customerRow.externalId} وتحديث بياناته بأمان.`)
          : localized(locale, `Customer ${customerRow.externalId} was created.`, `تم إنشاء العميل ${customerRow.externalId}.`),
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
  user: CurrentUser,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const input = ResolvedOrderActionSchema.parse(raw);
  let record: ExecutionRecord | null = null;
  const result = await createOrderFromInput({
    locale,
    placedAt: input.placedAt,
    customerExternalId: input.customerExternalId,
    newCustomer: input.newCustomer,
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
    lines: input.lines.map(({ sku, quantity, unitGrossPrice, lineDiscount }) => ({
      sku,
      quantity,
      unitGrossPrice,
      lineDiscount,
    })),
  }, {
    actorContext: createTrustedCommandContext(user),
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
  user: CurrentUser,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const input = ResolvedExpenseActionSchema.parse(raw);
  let record: ExecutionRecord | null = null;
  const result = await createCentralRecordFromInput({
    locale,
    recordKind: 'MONEY_OUT',
    date: input.date,
    amount: input.amount,
    currency: input.currency,
    rate: input.rate,
    accountId: input.accountId,
    categoryType: input.categoryType,
    partyId: input.partyId,
    newParty: input.newParty ?? undefined,
    description: input.description,
    reference: input.reference,
    branchId: input.branchId,
  }, {
    actorContext: createTrustedCommandContext(user),
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
  user: CurrentUser,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const input = ResolvedPurchaseActionSchema.parse(raw);
  const isInventory = input.purchaseType === 'INVENTORY';
  let record: ExecutionRecord | null = null;
  const result = await createCentralRecordFromInput({
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
    newParty: input.newSupplier ?? undefined,
    paymentMode: input.paidMode,
    paidAmount: input.paidAmount,
    accountId: input.accountId,
    paymentMethod: input.paymentMethod,
    paymentDate: input.paymentDate,
    dueDate: input.dueDate,
    branchId: input.branchId,
    reference: input.reference,
    description: input.notes || (isInventory ? input.newItemNameEn : input.assetName),
  }, {
    actorContext: createTrustedCommandContext(user),
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
  user: CurrentUser,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const input = ResolvedOrderStatusActionSchema.parse(raw);
  const record: ExecutionRecord = {
    recordType: 'Order',
    recordId: input.orderId,
    href: `/admin/records/orders/${input.orderId}`,
    message: localized(locale, `Order ${input.orderNumber} is now ${input.status}.`, `أصبحت حالة الطلب ${input.orderNumber}: ${input.status}.`),
  };
  const result = await bulkUpdateOrdersFromInput({
    orderIds: [input.orderId],
    operation: 'STATUS',
    status: input.status,
    completionMode: input.completionMode,
    accountId: input.accountId,
    providerKey: input.providerKey,
    paymentMethod: input.paymentMethod,
    date: input.date,
  }, {
    actorContext: createTrustedCommandContext(user),
    beforeExecute,
    onCommitted: (tx) => onCommitted(tx, record),
  });
  if (!result?.ok) throw new Error(result?.error || 'order_status_failed');
  return record;
}

async function executeCustomerUpdate(
  raw: unknown,
  user: CurrentUser,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const input = ResolvedCustomerUpdateActionSchema.parse(raw);
  const { externalId, ...changes } = input;
  let record: ExecutionRecord | null = null;
  const result = await updateCustomerCommand(
    changes,
    { actorId: user.id, source: 'ai-assistant' },
    {
      beforeExecute,
      onCommitted: async (tx, customer) => {
        record = {
          recordType: 'Customer',
          recordId: customer.id,
          href: `/admin/records/customers/${customer.id}`,
          message: localized(locale, `Customer ${customer.externalId ?? externalId ?? customer.id} was updated.`, `تم تحديث العميل ${customer.externalId ?? externalId ?? customer.id}.`),
        };
        await onCommitted(tx, record);
      },
    },
  );
  return record ?? {
    recordType: 'Customer',
    recordId: result.id,
    href: `/admin/records/customers/${result.id}`,
    message: localized(locale, 'The customer was updated.', 'تم تحديث العميل.'),
  };
}

async function executePartyUpdate(
  raw: unknown,
  user: CurrentUser,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const input = ResolvedPartyUpdateActionSchema.parse(raw);
  const { partyName, ...changes } = input;
  let record: ExecutionRecord | null = null;
  const result = await updatePartyCommand(
    changes,
    { actorId: user.id, source: 'ai-assistant' },
    {
      beforeExecute,
      onCommitted: async (tx, party) => {
        record = {
          recordType: 'Party',
          recordId: party.id,
          href: `/finance/parties/${party.id}`,
          message: localized(locale, `${partyName} was updated.`, `تم تحديث ${partyName}.`),
        };
        await onCommitted(tx, record);
      },
    },
  );
  return record ?? {
    recordType: 'Party',
    recordId: result.id,
    href: `/finance/parties/${result.id}`,
    message: localized(locale, `${partyName} was updated.`, `تم تحديث ${partyName}.`),
  };
}

async function executeInventoryAdjustment(
  raw: unknown,
  user: CurrentUser,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const input = ResolvedInventoryAdjustmentActionSchema.parse(raw);
  const record: ExecutionRecord = {
    recordType: 'InventoryItem',
    recordId: input.inventoryItemId,
    href: `/admin/records/inventory/${input.inventoryItemId}`,
    message: localized(locale, `${input.inventoryItemName} inventory was adjusted to ${input.targetQuantity}.`, `تم تعديل مخزون ${input.inventoryItemName} إلى ${input.targetQuantity}.`),
  };
  await adjustInventoryFromInput(
    {
      inventoryItemId: input.inventoryItemId,
      targetQuantity: input.targetQuantity,
      occurredAt: input.occurredAt,
      reason: input.reason,
    },
    {
      actorContext: createTrustedCommandContext(user),
      precondition: beforeExecute,
      onCommitted: (tx) => onCommitted(tx, record),
    },
  );
  return record;
}

async function executeRoastBatch(
  raw: unknown,
  user: CurrentUser,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const input = ResolvedRoastBatchActionSchema.parse(raw);
  let record: ExecutionRecord | null = null;
  const result = await createRoastBatchFromInput(
    {
      ...input,
      roastDate: input.roastDate ?? undefined,
      roastLevel: input.roastLevel ?? undefined,
      roastedOutputGrams: input.roastedOutputGrams ?? undefined,
      qcScore: input.qcScore ?? undefined,
      qcNotes: input.qcNotes ?? undefined,
      greenInventoryItemId: input.greenInventoryItemId,
      roastedInventoryItemId: input.roastedInventoryItemId,
      branchId: input.branchId,
    },
    {
      actorContext: createTrustedCommandContext(user),
      precondition: beforeExecute,
      onCommitted: async (tx, batch) => {
        record = {
          recordType: 'RoastBatch',
          recordId: batch.recordId,
          href: `/admin/records/batches/${batch.recordId}`,
          message: localized(locale, `Roast batch ${batch.batchNumber} was created.`, `تم إنشاء دفعة التحميص ${batch.batchNumber}.`),
        };
        await onCommitted(tx, record);
      },
    },
  );
  return record ?? {
    recordType: 'RoastBatch',
    recordId: result.recordId,
    href: `/admin/records/batches/${result.recordId}`,
    message: localized(locale, `Roast batch ${result.batchNumber} was created.`, `تم إنشاء دفعة التحميص ${result.batchNumber}.`),
  };
}

async function executePayment(
  raw: unknown,
  user: CurrentUser,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const input = ResolvedPaymentActionSchema.parse(raw);
  let record: ExecutionRecord | null = null;
  if (input.targetType === 'ORDER') {
    const result = await recordInvoicePaymentFromInput(
      {
        orderId: input.targetId,
        amount: input.amount,
        accountId: input.accountId,
        paymentMethod: input.paymentMethod ?? undefined,
        date: input.date,
      },
      {
        actorContext: createTrustedCommandContext(user),
        beforeExecute,
        onCommitted: async (tx, payment) => {
          record = {
            recordType: 'FinanceEntry',
            recordId: payment.recordId,
            href: `/finance/ledger/${payment.recordId}`,
            invoiceHref: `/invoice/${payment.orderId}`,
            message: localized(locale, `Payment for ${payment.orderNumber} was recorded.`, `تم تسجيل دفعة للطلب ${payment.orderNumber}.`),
          };
          await onCommitted(tx, record);
        },
      },
    );
    return record ?? {
      recordType: 'FinanceEntry',
      recordId: result.recordId,
      href: `/finance/ledger/${result.recordId}`,
      invoiceHref: `/invoice/${result.orderId}`,
      message: localized(locale, `Payment for ${result.orderNumber} was recorded.`, `تم تسجيل دفعة للطلب ${result.orderNumber}.`),
    };
  }
  const result = await settleFinanceEntryFromInput(
    {
      obligationId: input.targetId,
      amount: input.amount,
      accountId: input.accountId,
      paymentMethod: input.paymentMethod ?? undefined,
      date: input.date,
    },
    {
      actorContext: createTrustedCommandContext(user),
      precondition: beforeExecute,
      onCommitted: async (tx, payment) => {
        record = {
          recordType: 'FinanceEntry',
          recordId: payment.recordId,
          href: `/finance/ledger/${payment.recordId}`,
          message: localized(locale, `Payment for ${input.targetNumber} was recorded.`, `تم تسجيل دفعة للسجل ${input.targetNumber}.`),
        };
        await onCommitted(tx, record);
      },
    },
  );
  return record ?? {
    recordType: 'FinanceEntry',
    recordId: result.recordId,
    href: `/finance/ledger/${result.recordId}`,
    message: localized(locale, `Payment for ${input.targetNumber} was recorded.`, `تم تسجيل دفعة للسجل ${input.targetNumber}.`),
  };
}

async function executeRefund(
  raw: unknown,
  user: CurrentUser,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const input = ResolvedRefundActionSchema.parse(raw);
  let record: ExecutionRecord | null = null;
  const result = await recordOrderRefundFromInput(
    {
      orderId: input.orderId,
      amount: input.amount,
      accountId: input.accountId,
      paymentMethod: input.paymentMethod ?? undefined,
      date: input.date,
      reason: input.reason,
    },
    {
      actorContext: createTrustedCommandContext(user),
      beforeExecute,
      onCommitted: async (tx, refund) => {
        record = {
          recordType: 'FinanceEntry',
          recordId: refund.recordId,
          href: `/finance/ledger/${refund.recordId}`,
          invoiceHref: `/invoice/${refund.orderId}`,
          message: localized(locale, `Refund for ${refund.orderNumber} was recorded.`, `تم تسجيل استرداد للطلب ${refund.orderNumber}.`),
        };
        await onCommitted(tx, record);
      },
    },
  );
  return record ?? {
    recordType: 'FinanceEntry',
    recordId: result.recordId,
    href: `/finance/ledger/${result.recordId}`,
    invoiceHref: `/invoice/${result.orderId}`,
    message: localized(locale, `Refund for ${result.orderNumber} was recorded.`, `تم تسجيل استرداد للطلب ${result.orderNumber}.`),
  };
}

async function executeReversal(
  raw: unknown,
  user: CurrentUser,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const input = ResolvedReversalActionSchema.parse(raw);
  const record: ExecutionRecord = {
    recordType: 'FinanceEntry',
    recordId: input.financeEntryId,
    href: `/finance/ledger/${input.financeEntryId}`,
    message: localized(locale, `${input.recordNumber} was reversed.`, `تم عكس السجل ${input.recordNumber}.`),
  };
  await reverseFinanceEntryFromInput(
    { entryId: input.financeEntryId, reason: input.reason },
    {
      actorContext: createTrustedCommandContext(user),
      precondition: beforeExecute,
      onCommitted: (tx) => onCommitted(tx, record),
    },
  );
  return record;
}

async function executeReclassification(
  raw: unknown,
  user: CurrentUser,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const input = ResolvedSpendReclassificationActionSchema.parse(raw);
  const record: ExecutionRecord = {
    recordType: 'FinanceEntry',
    recordId: input.entryId,
    href: `/finance/ledger/${input.entryId}`,
    message: localized(locale, `${input.lineName} was reclassified as ${input.spendTreatment}.`, `تمت إعادة تصنيف ${input.lineName} إلى ${input.spendTreatment}.`),
  };
  await reclassifyLedgerLineFromInput(
    {
      entryId: input.entryId,
      lineId: input.lineId,
      spendTreatment: input.spendTreatment,
      classificationNote: input.classificationNote,
      fixedAssetId: input.fixedAssetId,
      inventoryItemId: input.inventoryItemId,
    },
    {
      actorContext: createTrustedCommandContext(user),
      precondition: beforeExecute,
      onCommitted: (tx) => onCommitted(tx, record),
    },
  );
  return record;
}

async function executeDashboardDraft(
  raw: unknown,
  user: CurrentUser,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const input = ResolvedDashboardDraftActionSchema.parse(raw);
  let record: ExecutionRecord | null = null;
  const result = await createDashboardDraftCommand(input, user, {
    beforeExecute,
    onCommitted: async (tx, dashboard) => {
      record = {
        recordType: 'Dashboard',
        recordId: dashboard.recordId,
        href: `/dashboard-builder/${dashboard.recordId}`,
        message: localized(locale, `Dashboard draft ${dashboard.name} was created.`, `تم إنشاء مسودة لوحة ${dashboard.name}.`),
      };
      await onCommitted(tx, record);
    },
  });
  return record ?? {
    recordType: 'Dashboard',
    recordId: result.recordId,
    href: `/dashboard-builder/${result.recordId}`,
    message: localized(locale, `Dashboard draft ${result.name} was created.`, `تم إنشاء مسودة لوحة ${result.name}.`),
  };
}

async function executeByType(
  type: AiPendingActionType,
  raw: unknown,
  user: CurrentUser,
  locale: AppLocale,
  beforeExecute: (tx: Prisma.TransactionClient) => Promise<void>,
  onCommitted: (tx: Prisma.TransactionClient, record: ExecutionRecord) => Promise<void>,
) {
  const schema = ACTION_DATA_SCHEMAS[type];
  if (!schema) throw new Error('action_not_supported');
  schema.parse(raw);
  switch (type) {
    case 'CREATE_CUSTOMER':
      return executeCustomer(raw, user, locale, beforeExecute, onCommitted);
    case 'CREATE_ORDER':
      return executeOrder(raw, user, locale, beforeExecute, onCommitted);
    case 'CREATE_EXPENSE':
      return executeExpense(raw, user, locale, beforeExecute, onCommitted);
    case 'CREATE_PURCHASE':
      return executePurchase(raw, user, locale, beforeExecute, onCommitted);
    case 'UPDATE_ORDER_STATUS':
      return executeOrderStatus(raw, user, locale, beforeExecute, onCommitted);
    case 'UPDATE_CUSTOMER':
      return executeCustomerUpdate(raw, user, locale, beforeExecute, onCommitted);
    case 'UPDATE_PARTY':
      return executePartyUpdate(raw, user, locale, beforeExecute, onCommitted);
    case 'ADJUST_INVENTORY':
      return executeInventoryAdjustment(raw, user, locale, beforeExecute, onCommitted);
    case 'CREATE_ROAST_BATCH':
      return executeRoastBatch(raw, user, locale, beforeExecute, onCommitted);
    case 'RECORD_PAYMENT':
      return executePayment(raw, user, locale, beforeExecute, onCommitted);
    case 'RECORD_REFUND':
      return executeRefund(raw, user, locale, beforeExecute, onCommitted);
    case 'REVERSE_RECORD':
      return executeReversal(raw, user, locale, beforeExecute, onCommitted);
    case 'RECLASSIFY_SPEND':
      return executeReclassification(raw, user, locale, beforeExecute, onCommitted);
    case 'CREATE_DASHBOARD_DRAFT':
      return executeDashboardDraft(raw, user, locale, beforeExecute, onCommitted);
    default:
      throw new Error('action_not_supported');
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
  confirmationText?: string;
}): Promise<ActionExecutionResult> {
  const action = await prisma.aiPendingAction.findFirst({
    where: { id: input.actionId, userId: input.user.id },
    include: {
      conversation: { select: { channel: true, externalThreadId: true } },
      executionReceipt: { include: { documents: { orderBy: { createdAt: 'asc' }, take: 1 } } },
    },
  });
  if (!action) throw new Error('notfound');
  await assertAssistantChannelAccess({
    user: input.user,
    channel: action.conversation.channel,
    actionType: action.type,
  });
  if (action.status === 'EXECUTED') {
    return storedExecutionResult(action, input.locale);
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
    const latest = await prisma.aiPendingAction.findUnique({
      where: { id: action.id },
      include: { executionReceipt: { include: { documents: { orderBy: { createdAt: 'asc' }, take: 1 } } } },
    });
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

  if (action.risk === 'HIGH') {
    const challenge = action.confirmationChallenge?.trim();
    if (!challenge) throw new Error('action_invalid');
    if (!action.confirmationRequestedAt) {
      await prisma.$transaction(async (tx) => {
        const requested = await tx.aiPendingAction.updateMany({
          where: {
            id: action.id,
            userId: input.user.id,
            status: 'PENDING',
            confirmationRequestedAt: null,
          },
          data: { confirmationRequestedAt: new Date() },
        });
        if (requested.count === 1) {
          await tx.auditLog.create({
            data: {
              userId: input.user.id,
              action: 'AI_HIGH_RISK_CONFIRMATION_REQUESTED',
              entity: 'AiPendingAction',
              entityId: action.id,
              metadata: { actionType: action.type, confirmationChallenge: challenge },
            },
          });
        }
      });
      return {
        actionId: action.id,
        status: 'PENDING',
        message: localized(
          input.locale,
          `This correction needs one final confirmation. Enter the affected record number exactly: ${challenge}`,
          `يتطلب هذا التصحيح تأكيداً نهائياً. أدخل رقم السجل المتأثر كما هو تماماً: ${challenge}`,
        ),
        committed: false,
        requiresSecondConfirmation: true,
        confirmationChallenge: challenge,
      };
    }
    if (normalizeAssistantText(input.confirmationText ?? '') !== normalizeAssistantText(challenge)) {
      return {
        actionId: action.id,
        status: 'PENDING',
        message: localized(
          input.locale,
          `Enter ${challenge} to confirm this correction. No data has changed yet.`,
          `أدخل ${challenge} لتأكيد هذا التصحيح. لم تتغير أي بيانات بعد.`,
        ),
        committed: false,
        requiresSecondConfirmation: true,
        confirmationChallenge: challenge,
      };
    }
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
            risk: action.risk,
            ...(action.risk === 'HIGH' ? { confirmationChallenge: action.confirmationChallenge } : {}),
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
  let committedArtifact: CommittedArtifact | undefined;
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
      async (tx, record) => {
        committedArtifact = await completePendingAction(tx, {
          actionId: action.id,
          userId: input.user.id,
          conversationId: action.conversationId,
          actionType: action.type,
          executionKey: action.executionKey,
          inputHash: preconditionHash(action.validatedData),
          channel: action.conversation.channel,
          deliveryDestination: action.conversation.externalThreadId,
          locale: input.locale,
          debugId,
          record,
        });
      },
    );
    if (!committedArtifact) throw new Error('execution_receipt_missing');
    const documentStatus = await prepareAiDocument(committedArtifact.documentId);
    return executionResult({
      actionId: action.id,
      record: result,
      artifact: committedArtifact,
      documentStatus,
    });
  } catch (error) {
    const latest = await prisma.aiPendingAction.findUnique({
      where: { id: action.id },
      include: { executionReceipt: { include: { documents: { orderBy: { createdAt: 'asc' }, take: 1 } } } },
    });
    if (latest?.status === 'EXECUTED' && latest.result) {
      return storedExecutionResult(latest, input.locale);
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
  const access = await prisma.aiPendingAction.findFirst({
    where: { id: input.actionId, userId: input.user.id },
    select: { conversation: { select: { channel: true } } },
  });
  if (!access) throw new Error('notfound');
  await assertAssistantChannelAccess({ user: input.user, channel: access.conversation.channel });
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
