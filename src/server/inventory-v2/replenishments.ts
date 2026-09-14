import 'server-only';
import type { CurrentUser } from '@/server/auth/session';
import { prisma } from '@/server/db/client';
import { COMMAND_TRANSACTION_OPTIONS } from '@/server/commands/transaction-checkpoints';
import { auditStockCommand } from './internal';
import { requireInventoryV2Enabled } from './config';
import { inventoryCommandError } from './errors';
import {
  assertInventoryCommandReplay,
  inventoryCommandInputHash,
  lockInventoryCommandKey,
} from './idempotency';
import {
  ReviewReplenishmentRequestCommandSchema,
  type ReviewReplenishmentRequestCommandInput,
} from './schemas';

export function replenishmentTransition(
  current: 'OPEN' | 'IN_PROGRESS' | 'FULFILLED' | 'CANCELLED',
  decision: 'START' | 'CANCEL',
): 'IN_PROGRESS' | 'CANCELLED' {
  if (decision === 'START' && current === 'OPEN') return 'IN_PROGRESS';
  if (decision === 'CANCEL' && (current === 'OPEN' || current === 'IN_PROGRESS')) {
    return 'CANCELLED';
  }
  throw new Error('replenishment_transition_invalid');
}

export async function reviewReplenishmentRequest(
  actor: CurrentUser,
  input: ReviewReplenishmentRequestCommandInput,
) {
  requireInventoryV2Enabled();
  try {
    const command = ReviewReplenishmentRequestCommandSchema.parse(input);
    if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') {
      throw new Error('replenishment_review_forbidden');
    }
    const inputHash = inventoryCommandInputHash('REVIEW_REPLENISHMENT_REQUEST', actor.id, command);

    return await prisma.$transaction(async (tx) => {
      await lockInventoryCommandKey(tx, command.idempotencyKey);
      await lockInventoryCommandKey(tx, `review-replenishment:${command.replenishmentRequestId}`);
      const replay = await tx.stockReplenishmentRequest.findUnique({
        where: { reviewIdempotencyKey: command.idempotencyKey },
        select: { id: true, requestNumber: true, status: true, reviewInputHash: true },
      });
      if (replay) {
        assertInventoryCommandReplay(replay.reviewInputHash, inputHash);
        const expectedStatus = command.decision === 'START' ? 'IN_PROGRESS' : 'CANCELLED';
        if (replay.id !== command.replenishmentRequestId || replay.status !== expectedStatus) {
          throw new Error('idempotency_conflict');
        }
        return {
          replenishmentRequestId: replay.id,
          requestNumber: replay.requestNumber,
          status: replay.status,
          replayed: true,
        };
      }

      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "StockReplenishmentRequest"
        WHERE "id" = ${command.replenishmentRequestId}
        FOR UPDATE
      `;
      const request = await tx.stockReplenishmentRequest.findUnique({
        where: { id: command.replenishmentRequestId },
        select: {
          id: true,
          requestNumber: true,
          status: true,
          version: true,
          locationId: true,
          inventoryItemId: true,
          orderId: true,
        },
      });
      if (!request) throw new Error('replenishment_not_found');
      if (request.version !== command.expectedRequestVersion) {
        throw new Error('document_stale');
      }
      const status = replenishmentTransition(request.status, command.decision);
      const reviewedAt = new Date();
      await tx.stockReplenishmentRequest.update({
        where: { id: request.id },
        data: {
          status,
          reviewedById: actor.id,
          reviewedAt,
          reviewReason: command.reason,
          reviewIdempotencyKey: command.idempotencyKey,
          reviewInputHash: inputHash,
          version: { increment: 1 },
        },
      });
      await auditStockCommand(
        tx,
        actor,
        status === 'IN_PROGRESS' ? 'START_REPLENISHMENT' : 'CANCEL_REPLENISHMENT',
        'StockReplenishmentRequest',
        request.id,
        {
          requestNumber: request.requestNumber,
          inventoryItemId: request.inventoryItemId,
          locationId: request.locationId,
          orderId: request.orderId,
          fromStatus: request.status,
          toStatus: status,
          reason: command.reason,
          reviewedAt: reviewedAt.toISOString(),
        },
      );
      return {
        replenishmentRequestId: request.id,
        requestNumber: request.requestNumber,
        status,
        replayed: false,
      };
    }, COMMAND_TRANSACTION_OPTIONS);
  } catch (error) {
    throw inventoryCommandError(error, 'review_replenishment');
  }
}
