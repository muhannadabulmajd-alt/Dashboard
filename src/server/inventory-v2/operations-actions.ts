'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseBaghdadDateTime } from '@/lib/dates';
import {
  optField,
  reqField,
  requireCap,
  type ActionState,
} from '@/server/records/shared';
import { approveInventoryCount, rejectInventoryCount, submitInventoryCount } from './counts';
import { InventoryCommandError } from './errors';
import { packFinishedGoods } from './packing';
import { receivePurchasedStock } from './receipts';
import { reverseStockDocument } from './reversals';
import { reviewReplenishmentRequest } from './replenishments';
import { roastGreenCoffee } from './roasting';
import { disposeReturnedGoods, returnFinishedGoodsToQuarantine } from './returns';
import { resolveStockDiscrepancy } from './discrepancies';
import { dispatchStockTransfer, receiveStockTransfer } from './transfers';

const INVENTORY_PATH = '/[locale]/(dashboard)/admin/records/inventory';

function actionError(error: unknown): ActionState {
  if (error instanceof InventoryCommandError) {
    return {
      error: error.failure.code,
      fieldErrors: error.failure.fieldErrors,
      stage: error.failure.stage,
      debugId: error.failure.debugId,
    };
  }
  return { error: error instanceof Error ? error.message.split(':')[0] : 'invalid_input' };
}

function parseDate(formData: FormData, key: string, required = true): Date | undefined {
  const value = required ? reqField(formData, key) : optField(formData, key);
  const parsed = parseBaghdadDateTime(value);
  if (!parsed && required) throw new Error('invalid_date');
  return parsed ?? undefined;
}

function parseJsonField(formData: FormData, key: string): unknown {
  try {
    return JSON.parse(reqField(formData, key) || '[]');
  } catch {
    throw new Error('invalid_input');
  }
}

function isNavigationError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'digest' in error);
}

function revalidateInventory(): void {
  revalidatePath(INVENTORY_PATH, 'page');
}

export async function dispatchStockTransferAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:inventory');
  if (!actor) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  try {
    const result = await dispatchStockTransfer(actor, {
      sourceLocationId: reqField(formData, 'sourceLocationId'),
      destinationLocationId: reqField(formData, 'destinationLocationId'),
      lines: parseJsonField(formData, 'lines') as never,
      occurredAt: parseDate(formData, 'occurredAt')!,
      expectedAt: parseDate(formData, 'expectedAt', false),
      notes: optField(formData, 'notes'),
      idempotencyKey: reqField(formData, 'idempotencyKey'),
      expectedSourceVersion: reqField(formData, 'expectedSourceVersion'),
      expectedTransitVersion: reqField(formData, 'expectedTransitVersion'),
    });
    revalidateInventory();
    redirect(`/${locale}/admin/records/inventory/transfers/${result.stockDocumentId}`);
  } catch (error) {
    if (isNavigationError(error)) throw error;
    return actionError(error);
  }
}

export async function receiveStockTransferAction(
  stockDocumentId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:inventory');
  if (!actor) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  try {
    await receiveStockTransfer(actor, {
      stockDocumentId,
      destinationLocationId: reqField(formData, 'destinationLocationId'),
      lines: parseJsonField(formData, 'lines') as never,
      discrepancies: parseJsonField(formData, 'discrepancies') as never,
      occurredAt: parseDate(formData, 'occurredAt')!,
      notes: optField(formData, 'notes'),
      idempotencyKey: reqField(formData, 'idempotencyKey'),
      expectedTransitVersion: reqField(formData, 'expectedTransitVersion'),
      expectedDestinationVersion: reqField(formData, 'expectedDestinationVersion'),
      expectedDocumentVersion: reqField(formData, 'expectedDocumentVersion'),
    });
    revalidateInventory();
    redirect(`/${locale}/admin/records/inventory/transfers/${stockDocumentId}`);
  } catch (error) {
    if (isNavigationError(error)) throw error;
    return actionError(error);
  }
}

export async function resolveStockDiscrepancyAction(
  stockDiscrepancyId: string,
  returnPath: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:inventory');
  if (!actor) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  try {
    await resolveStockDiscrepancy(actor, {
      stockDiscrepancyId,
      decision: reqField(formData, 'decision') as 'APPROVE' | 'REJECT',
      resolution: reqField(formData, 'resolution'),
      approvedUnitCost: optField(formData, 'approvedUnitCost'),
      occurredAt: parseDate(formData, 'occurredAt')!,
      idempotencyKey: reqField(formData, 'idempotencyKey'),
      expectedDiscrepancyVersion: reqField(formData, 'expectedDiscrepancyVersion'),
      expectedLocationVersion: reqField(formData, 'expectedLocationVersion'),
    });
    revalidateInventory();
    revalidatePath('/[locale]/(dashboard)/admin/records/batches', 'page');
    const safeReturnPath = returnPath.startsWith(`/${locale}/admin/records/`)
      ? returnPath
      : `/${locale}/admin/records/inventory`;
    redirect(safeReturnPath);
  } catch (error) {
    if (isNavigationError(error)) throw error;
    return actionError(error);
  }
}

export async function reverseStockDocumentAction(
  stockDocumentId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:inventory');
  if (!actor) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  try {
    await reverseStockDocument(actor, {
      stockDocumentId,
      confirmationDocumentNumber: reqField(formData, 'confirmationDocumentNumber'),
      reason: reqField(formData, 'reason'),
      occurredAt: parseDate(formData, 'occurredAt')!,
      idempotencyKey: reqField(formData, 'idempotencyKey'),
      expectedDocumentVersion: reqField(formData, 'expectedDocumentVersion'),
      expectedLocationVersions: parseJsonField(formData, 'expectedLocationVersions') as never,
    });
    revalidateInventory();
    revalidatePath('/[locale]/(dashboard)/admin/records/batches', 'page');
    redirect(`/${locale}/admin/records/inventory/documents/${stockDocumentId}`);
  } catch (error) {
    if (isNavigationError(error)) throw error;
    return actionError(error);
  }
}

export async function reviewReplenishmentRequestAction(
  replenishmentRequestId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:inventory');
  if (!actor) return { error: 'forbidden' };
  try {
    const result = await reviewReplenishmentRequest(actor, {
      replenishmentRequestId,
      decision: reqField(formData, 'decision') as 'START' | 'CANCEL',
      reason: reqField(formData, 'reason'),
      idempotencyKey: reqField(formData, 'idempotencyKey'),
      expectedRequestVersion: reqField(formData, 'expectedRequestVersion'),
    });
    revalidateInventory();
    return {
      ok: true,
      recordId: result.replenishmentRequestId,
      recordNumber: result.requestNumber,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function submitInventoryCountAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:inventory');
  if (!actor) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  try {
    const result = await submitInventoryCount(actor, {
      locationId: reqField(formData, 'locationId'),
      kind: reqField(formData, 'kind') as 'ROUTINE' | 'OPENING',
      countedAt: parseDate(formData, 'countedAt')!,
      reason: reqField(formData, 'reason'),
      openingAttestation: formData.get('openingAttestation') === 'true',
      lines: parseJsonField(formData, 'lines') as never,
      idempotencyKey: reqField(formData, 'idempotencyKey'),
      expectedLocationVersion: reqField(formData, 'expectedLocationVersion'),
    });
    revalidateInventory();
    redirect(`/${locale}/admin/records/inventory/counts/${result.inventoryCountId}`);
  } catch (error) {
    if (isNavigationError(error)) throw error;
    return actionError(error);
  }
}

export async function approveInventoryCountAction(
  inventoryCountId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:inventory');
  if (!actor) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  try {
    await approveInventoryCount(actor, {
      inventoryCountId,
      reason: reqField(formData, 'reason'),
      occurredAt: parseDate(formData, 'occurredAt')!,
      idempotencyKey: reqField(formData, 'idempotencyKey'),
      expectedLocationVersion: reqField(formData, 'expectedLocationVersion'),
      expectedCountVersion: reqField(formData, 'expectedCountVersion'),
    });
    revalidateInventory();
    redirect(`/${locale}/admin/records/inventory/counts/${inventoryCountId}`);
  } catch (error) {
    if (isNavigationError(error)) throw error;
    return actionError(error);
  }
}

export async function rejectInventoryCountAction(
  inventoryCountId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:inventory');
  if (!actor) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  try {
    await rejectInventoryCount(actor, {
      inventoryCountId,
      reason: reqField(formData, 'reason'),
      idempotencyKey: reqField(formData, 'idempotencyKey'),
      expectedCountVersion: reqField(formData, 'expectedCountVersion'),
    });
    revalidateInventory();
    redirect(`/${locale}/admin/records/inventory/counts/${inventoryCountId}`);
  } catch (error) {
    if (isNavigationError(error)) throw error;
    return actionError(error);
  }
}

export async function receivePurchasedStockAction(
  inventoryItemId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:inventory');
  if (!actor) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  try {
    await receivePurchasedStock(actor, {
      inventoryItemId,
      locationId: reqField(formData, 'locationId'),
      quantity: reqField(formData, 'quantity'),
      unitCost: reqField(formData, 'unitCost'),
      occurredAt: parseDate(formData, 'occurredAt')!,
      bestBefore: parseDate(formData, 'bestBefore', false),
      supplierLot: optField(formData, 'supplierLot'),
      reference: optField(formData, 'reference'),
      notes: optField(formData, 'notes'),
      paymentMode: reqField(formData, 'paymentMode') as 'PAID' | 'CREDIT',
      accountId: optField(formData, 'accountId'),
      partyId: reqField(formData, 'partyId'),
      dueDate: parseDate(formData, 'dueDate', false),
      idempotencyKey: reqField(formData, 'idempotencyKey'),
      expectedLocationVersion: reqField(formData, 'expectedLocationVersion'),
    });
    revalidateInventory();
    redirect(`/${locale}/admin/records/inventory/${inventoryItemId}`);
  } catch (error) {
    if (isNavigationError(error)) throw error;
    return actionError(error);
  }
}

export async function packFinishedGoodsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:inventory');
  if (!actor) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  try {
    const result = await packFinishedGoods(actor, {
      locationId: reqField(formData, 'locationId'),
      productId: reqField(formData, 'productId'),
      outputInventoryItemId: reqField(formData, 'outputInventoryItemId'),
      recipeVersionId: reqField(formData, 'recipeVersionId'),
      outputQuantity: reqField(formData, 'outputQuantity'),
      rejectedQuantity: reqField(formData, 'rejectedQuantity') || '0',
      packedAt: parseDate(formData, 'packedAt')!,
      bestBefore: parseDate(formData, 'bestBefore', false),
      notes: optField(formData, 'notes'),
      idempotencyKey: reqField(formData, 'idempotencyKey'),
      expectedLocationVersion: reqField(formData, 'expectedLocationVersion'),
    });
    revalidateInventory();
    redirect(`/${locale}/admin/records/inventory/packing/${result.packingBatchId}`);
  } catch (error) {
    if (isNavigationError(error)) throw error;
    return actionError(error);
  }
}

export async function roastGreenCoffeeAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:batches');
  if (!actor) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  try {
    const result = await roastGreenCoffee(actor, {
      batchNumber: reqField(formData, 'batchNumber'),
      locationId: reqField(formData, 'locationId'),
      greenInventoryItemId: reqField(formData, 'greenInventoryItemId'),
      roastedInventoryItemId: reqField(formData, 'roastedInventoryItemId'),
      origin: reqField(formData, 'origin'),
      roastLevel: optField(formData, 'roastLevel'),
      greenInputGrams: reqField(formData, 'greenInputGrams'),
      roastedOutputGrams: reqField(formData, 'roastedOutputGrams'),
      abnormalLossGrams: reqField(formData, 'abnormalLossGrams') || '0',
      roastDate: parseDate(formData, 'roastDate')!,
      qcScore: optField(formData, 'qcScore'),
      qcNotes: optField(formData, 'qcNotes'),
      idempotencyKey: reqField(formData, 'idempotencyKey'),
      expectedLocationVersion: reqField(formData, 'expectedLocationVersion'),
    });
    revalidateInventory();
    revalidatePath('/[locale]/(dashboard)/admin/records/batches', 'page');
    redirect(`/${locale}/admin/records/batches/${result.roastBatchId}`);
  } catch (error) {
    if (isNavigationError(error)) throw error;
    return actionError(error);
  }
}

export async function returnFinishedGoodsToQuarantineAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:inventory');
  if (!actor) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  try {
    const result = await returnFinishedGoodsToQuarantine(actor, {
      orderLineId: reqField(formData, 'orderLineId'),
      quantity: reqField(formData, 'quantity'),
      occurredAt: parseDate(formData, 'occurredAt')!,
      reason: reqField(formData, 'reason'),
      idempotencyKey: reqField(formData, 'idempotencyKey'),
      expectedFulfillmentVersion: reqField(formData, 'expectedFulfillmentVersion'),
      expectedQuarantineVersion: reqField(formData, 'expectedQuarantineVersion'),
    });
    revalidateInventory();
    revalidatePath('/[locale]/(dashboard)/admin/records/orders', 'page');
    redirect(`/${locale}/admin/records/inventory/returns/${result.stockDocumentId}`);
  } catch (error) {
    if (isNavigationError(error)) throw error;
    return actionError(error);
  }
}

export async function disposeReturnedGoodsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:inventory');
  if (!actor) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  const returnDocumentId = reqField(formData, 'returnDocumentId');
  try {
    await disposeReturnedGoods(actor, {
      returnDocumentId,
      inventoryItemId: reqField(formData, 'inventoryItemId'),
      quantity: reqField(formData, 'quantity'),
      disposition: reqField(formData, 'disposition') as 'RESTOCK' | 'REPACK' | 'RETURN_TO_SUPPLIER' | 'WASTE',
      destinationLocationId: optField(formData, 'destinationLocationId'),
      supplierPartyId: optField(formData, 'supplierPartyId'),
      occurredAt: parseDate(formData, 'occurredAt')!,
      reason: reqField(formData, 'reason'),
      idempotencyKey: reqField(formData, 'idempotencyKey'),
      expectedQuarantineVersion: reqField(formData, 'expectedQuarantineVersion'),
      expectedDestinationVersion: optField(formData, 'expectedDestinationVersion'),
      expectedReturnDocumentVersion: reqField(formData, 'expectedReturnDocumentVersion'),
    });
    revalidateInventory();
    redirect(`/${locale}/admin/records/inventory/returns/${returnDocumentId}`);
  } catch (error) {
    if (isNavigationError(error)) throw error;
    return actionError(error);
  }
}
