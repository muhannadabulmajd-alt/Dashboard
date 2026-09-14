import 'server-only';
import { createHash } from 'node:crypto';
import type { ExpenseCategoryType, Prisma } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/session';
import { validateAiAttachment } from '@/server/ai/attachments';
import { prisma } from '@/server/db/client';
import { COMMAND_TRANSACTION_OPTIONS } from '@/server/commands/transaction-checkpoints';
import type {
  CommandCommitHook,
  CommandPreconditionHook,
} from '@/server/records/shared';
import { requireInventoryV2Enabled } from './config';
import { inventoryCommandError } from './errors';
import {
  assertInventoryCommandReplay,
  inventoryCommandInputHash,
  lockInventoryCommandKey,
} from './idempotency';
import { auditStockCommand, bumpLocationVersion, lockLocation } from './internal';
import {
  LOCAL_EXPENSE_RECEIPT_MAX_BYTES,
  localExpenseAccountMatchesLocation,
  localExpenseRequiresReview,
} from './local-expense-policy';
import { generateLocalExpenseRequestNumber } from './numbering';
import {
  LocationExpensePolicySchema,
  RecordLocalExpenseCommandSchema,
  ReviewLocalExpenseCommandSchema,
  type LocationExpensePolicyInput,
  type RecordLocalExpenseCommandInput,
  type ReviewLocalExpenseCommandInput,
} from './schemas';

type Tx = Prisma.TransactionClient;

type ValidatedReceipt = {
  content: Uint8Array<ArrayBuffer>;
  fileName: string;
  mimeType: string;
  byteSize: number;
  checksum: string;
} | null;

export type LocalExpenseResult = {
  requestId: string;
  requestNumber: string;
  status: 'SUBMITTED' | 'POSTED' | 'REJECTED';
  financeEntryId: string | null;
  replayed: boolean;
};

function assertCentralActor(actor: CurrentUser): void {
  if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') throw new Error('forbidden');
}

export function validateLocalExpenseReceipt(
  receipt: { bytes: Uint8Array; fileName: string; declaredMimeType?: string } | undefined,
): ValidatedReceipt {
  if (!receipt) return null;
  const detected = validateAiAttachment({
    bytes: receipt.bytes,
    fileName: receipt.fileName,
    declaredMimeType: receipt.declaredMimeType,
    maxBytes: LOCAL_EXPENSE_RECEIPT_MAX_BYTES,
  });
  if (detected.kind === 'AUDIO') throw new Error('expense_receipt_type_unsupported');
  return {
    content: new Uint8Array(receipt.bytes),
    fileName: detected.fileName,
    mimeType: detected.mimeType,
    byteSize: receipt.bytes.byteLength,
    checksum: createHash('sha256').update(receipt.bytes).digest('hex'),
  };
}

function resultFromRequest(
  request: {
    id: string;
    requestNumber: string;
    status: 'SUBMITTED' | 'POSTED' | 'REJECTED';
    financeEntryId: string | null;
  },
  replayed: boolean,
): LocalExpenseResult {
  return {
    requestId: request.id,
    requestNumber: request.requestNumber,
    status: request.status,
    financeEntryId: request.financeEntryId,
    replayed,
  };
}

async function postLocalExpenseFinance(
  tx: Tx,
  request: {
    id: string;
    requestNumber: string;
    locationId: string;
    accountId: string;
    amount: number;
    categoryType: ExpenseCategoryType;
    date: Date;
    description: string;
    noReceiptReason: string | null;
    submittedById: string;
  },
  branchId: string,
  attachmentId: string | null,
): Promise<string> {
  const entry = await tx.financeEntry.create({
    data: {
      date: request.date,
      type: 'EXPENSE',
      recordClass: 'EXPENSE',
      amount: request.amount,
      currency: 'IQD',
      obligation: false,
      accountId: request.accountId,
      categoryType: request.categoryType,
      costRole: 'OPERATING',
      paymentMethod: 'OTHER',
      importKey: `LOCAL_EXPENSE:${request.id}`,
      description: request.description,
      reference: request.requestNumber,
      attachmentUrl: attachmentId
        ? `/api/finance/local-expenses/attachments/${attachmentId}`
        : null,
      branchId,
      stockLocationId: request.locationId,
      createdById: request.submittedById,
    },
    select: { id: true },
  });
  await tx.ledgerEntryLine.create({
    data: {
      financeEntryId: entry.id,
      lineNo: 1,
      itemType: 'EXPENSE',
      itemName: request.description,
      categoryType: request.categoryType,
      unit: 'unit',
      quantity: '1.000',
      unitCost: request.amount.toFixed(3),
      landedUnitCost: request.amount.toFixed(3),
      lineTotal: request.amount,
      branchId,
      notes: request.noReceiptReason,
      spendTreatment: 'OPEX',
      classificationStatus: 'CONFIRMED',
      classificationSource: 'local-expense',
    },
  });
  return entry.id;
}

export async function recordLocalExpense(
  actor: CurrentUser,
  rawInput: RecordLocalExpenseCommandInput,
  options: {
    beforeExecute?: CommandPreconditionHook;
    onCommitted?: CommandCommitHook<LocalExpenseResult>;
  } = {},
): Promise<LocalExpenseResult> {
  requireInventoryV2Enabled();
  try {
    const command = RecordLocalExpenseCommandSchema.parse(rawInput);
    if (!actor.defaultFinanceAccountId) throw new Error('expense_default_account_required');
    const defaultFinanceAccountId = actor.defaultFinanceAccountId;
    const receipt = validateLocalExpenseReceipt(command.receipt);
    const inputHash = inventoryCommandInputHash('RECORD_LOCAL_EXPENSE', actor.id, command);

    return await prisma.$transaction(async (tx) => {
      await lockInventoryCommandKey(tx, command.idempotencyKey);
      await options.beforeExecute?.(tx);
      const replay = await tx.localExpenseRequest.findUnique({
        where: { idempotencyKey: command.idempotencyKey },
      });
      if (replay) {
        assertInventoryCommandReplay(replay.inputHash, inputHash);
        if (replay.submittedById !== actor.id) throw new Error('idempotency_conflict');
        const result = resultFromRequest(replay, true);
        await options.onCommitted?.(tx, result);
        return result;
      }

      const location = await lockLocation(
        tx,
        actor,
        command.locationId,
        'recordExpense',
        command.expectedLocationVersion,
      );
      const [account, policy] = await Promise.all([
        tx.financeAccount.findUnique({ where: { id: defaultFinanceAccountId } }),
        tx.locationExpensePolicy.findUnique({ where: { locationId: command.locationId } }),
      ]);
      if (!account || !localExpenseAccountMatchesLocation(account, location)) {
        throw new Error('expense_default_account_invalid');
      }

      const requiresReview = localExpenseRequiresReview(policy, {
        amount: command.amount,
        categoryType: command.categoryType,
        hasReceipt: Boolean(receipt),
      });
      const requestNumber = await generateLocalExpenseRequestNumber(tx, command.occurredAt);
      const request = await tx.localExpenseRequest.create({
        data: {
          requestNumber,
          locationId: command.locationId,
          accountId: account.id,
          amount: command.amount,
          categoryType: command.categoryType,
          date: command.occurredAt,
          description: command.description,
          noReceiptReason: command.noReceiptReason,
          status: requiresReview ? 'SUBMITTED' : 'POSTED',
          idempotencyKey: command.idempotencyKey,
          inputHash,
          submittedById: actor.id,
        },
      });
      const attachment = receipt
        ? await tx.localExpenseAttachment.create({
            data: {
              requestId: request.id,
              fileName: receipt.fileName,
              mimeType: receipt.mimeType,
              byteSize: receipt.byteSize,
              checksum: receipt.checksum,
              content: receipt.content,
              uploadedById: actor.id,
            },
            select: { id: true },
          })
        : null;
      let financeEntryId: string | null = null;
      if (!requiresReview) {
        financeEntryId = await postLocalExpenseFinance(
          tx,
          request,
          location.branchId,
          attachment?.id ?? null,
        );
        await tx.localExpenseRequest.update({
          where: { id: request.id },
          data: { financeEntryId },
        });
      }
      await auditStockCommand(tx, actor, 'RECORD_LOCAL_EXPENSE', 'LocalExpenseRequest', request.id, {
        requestNumber,
        locationId: request.locationId,
        accountId: request.accountId,
        amount: request.amount,
        categoryType: request.categoryType,
        status: request.status,
        financeEntryId,
        hasReceipt: Boolean(attachment),
      });
      const result = resultFromRequest({ ...request, financeEntryId }, false);
      await options.onCommitted?.(tx, result);
      return result;
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'record_local_expense');
  }
}

export async function reviewLocalExpense(
  actor: CurrentUser,
  rawInput: ReviewLocalExpenseCommandInput,
): Promise<LocalExpenseResult> {
  requireInventoryV2Enabled();
  try {
    assertCentralActor(actor);
    const command = ReviewLocalExpenseCommandSchema.parse(rawInput);
    const inputHash = inventoryCommandInputHash('REVIEW_LOCAL_EXPENSE', actor.id, command);
    return await prisma.$transaction(async (tx) => {
      await lockInventoryCommandKey(tx, command.idempotencyKey);
      await lockInventoryCommandKey(tx, `review-local-expense:${command.requestId}`);
      const replay = await tx.localExpenseRequest.findUnique({
        where: { reviewIdempotencyKey: command.idempotencyKey },
      });
      if (replay) {
        assertInventoryCommandReplay(replay.reviewInputHash, inputHash);
        if (replay.id !== command.requestId) throw new Error('idempotency_conflict');
        return resultFromRequest(replay, true);
      }
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "LocalExpenseRequest" WHERE "id" = ${command.requestId} FOR UPDATE
      `;
      const request = await tx.localExpenseRequest.findUnique({
        where: { id: command.requestId },
        include: { attachment: { select: { id: true } } },
      });
      if (!request) throw new Error('expense_request_not_found');
      if (request.status !== 'SUBMITTED') throw new Error('expense_request_already_reviewed');
      if (request.version !== command.expectedRequestVersion) throw new Error('expense_request_stale');
      const location = await lockLocation(
        tx,
        actor,
        request.locationId,
        'approve',
        command.expectedLocationVersion,
      );

      let financeEntryId: string | null = null;
      const status = command.decision === 'APPROVE' ? 'POSTED' : 'REJECTED';
      if (command.decision === 'APPROVE') {
        const account = await tx.financeAccount.findUnique({ where: { id: request.accountId } });
        if (!account || !localExpenseAccountMatchesLocation(account, location)) {
          throw new Error('expense_default_account_invalid');
        }
        financeEntryId = await postLocalExpenseFinance(
          tx,
          request,
          location.branchId,
          request.attachment?.id ?? null,
        );
      }
      const reviewed = await tx.localExpenseRequest.update({
        where: { id: request.id },
        data: {
          status,
          financeEntryId,
          reviewIdempotencyKey: command.idempotencyKey,
          reviewInputHash: inputHash,
          reviewedById: actor.id,
          reviewedAt: command.occurredAt,
          reviewReason: command.reason,
          version: { increment: 1 },
        },
      });
      await auditStockCommand(tx, actor, `LOCAL_EXPENSE_${command.decision}`, 'LocalExpenseRequest', request.id, {
        requestNumber: request.requestNumber,
        locationId: request.locationId,
        submittedById: request.submittedById,
        amount: request.amount,
        categoryType: request.categoryType,
        financeEntryId,
        reason: command.reason,
      });
      return resultFromRequest(reviewed, false);
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'review_local_expense');
  }
}

export async function saveLocationExpensePolicy(
  actor: CurrentUser,
  rawInput: LocationExpensePolicyInput,
) {
  requireInventoryV2Enabled();
  try {
    assertCentralActor(actor);
    const command = LocationExpensePolicySchema.parse(rawInput);
    return await prisma.$transaction(async (tx) => {
      await lockLocation(
        tx,
        actor,
        command.locationId,
        'approve',
        command.expectedLocationVersion,
      );
      const policy = await tx.locationExpensePolicy.upsert({
        where: { locationId: command.locationId },
        create: {
          locationId: command.locationId,
          isActive: command.isActive,
          allowedCategories: command.allowedCategories,
          maxImmediateAmount: command.maxImmediateAmount,
          receiptRequiredAbove: command.receiptRequiredAbove,
        },
        update: {
          isActive: command.isActive,
          allowedCategories: command.allowedCategories,
          maxImmediateAmount: command.maxImmediateAmount,
          receiptRequiredAbove: command.receiptRequiredAbove,
        },
      });
      const stockVersion = await bumpLocationVersion(tx, command.locationId);
      await auditStockCommand(tx, actor, 'UPSERT_LOCATION_EXPENSE_POLICY', 'LocationExpensePolicy', policy.id, {
        locationId: command.locationId,
        isActive: command.isActive,
        allowedCategories: command.allowedCategories,
        maxImmediateAmount: command.maxImmediateAmount,
        receiptRequiredAbove: command.receiptRequiredAbove,
        stockVersion,
      });
      return { ...policy, stockVersion };
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'save_location_expense_policy');
  }
}
