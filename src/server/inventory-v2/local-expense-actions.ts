'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireCap, reqField, optField, type ActionState } from '@/server/records/shared';
import { InventoryCommandError } from './errors';
import {
  recordLocalExpense,
  reviewLocalExpense,
  saveLocationExpensePolicy,
} from './local-expenses';

const LOCAL_EXPENSE_PATH = '/[locale]/(dashboard)/finance/local-expenses';
const FINANCE_PATH = '/[locale]/(dashboard)/finance';
const INVENTORY_PATH = '/[locale]/(dashboard)/admin/records/inventory';

function boolField(formData: FormData, key: string): boolean {
  return formData.get(key) === 'on' || formData.get(key) === 'true';
}

function actionError(error: unknown): ActionState {
  if (error instanceof InventoryCommandError) {
    return {
      error: error.failure.code,
      fieldErrors: error.failure.fieldErrors,
      stage: error.failure.stage,
      debugId: error.failure.debugId,
    };
  }
  return { error: error instanceof Error ? error.message.split(':')[0] : 'invalid' };
}

function revalidateLocalExpensePaths(): void {
  revalidatePath(LOCAL_EXPENSE_PATH, 'page');
  revalidatePath(FINANCE_PATH, 'page');
}

export async function recordLocalExpenseAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('record:local-expense');
  if (!actor) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  try {
    const upload = formData.get('receipt');
    const receipt = upload instanceof File && upload.size > 0
      ? {
          bytes: new Uint8Array(await upload.arrayBuffer()),
          fileName: upload.name,
          declaredMimeType: upload.type || undefined,
        }
      : undefined;
    const result = await recordLocalExpense(actor, {
      locationId: reqField(formData, 'locationId'),
      amount: reqField(formData, 'amount'),
      categoryType: reqField(formData, 'categoryType') as never,
      description: reqField(formData, 'description'),
      occurredAt: reqField(formData, 'occurredAt'),
      receipt,
      noReceiptReason: optField(formData, 'noReceiptReason'),
      idempotencyKey: reqField(formData, 'idempotencyKey'),
      expectedLocationVersion: reqField(formData, 'expectedLocationVersion'),
    });
    revalidateLocalExpensePaths();
    redirect(`/${locale}/finance/local-expenses?created=${encodeURIComponent(result.requestNumber)}`);
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    return actionError(error);
  }
}

export async function reviewLocalExpenseAction(
  requestId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('record:local-expense');
  if (!actor || (actor.role !== 'OWNER' && actor.role !== 'ADMIN')) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  try {
    const result = await reviewLocalExpense(actor, {
      requestId,
      decision: reqField(formData, 'decision') as never,
      reason: reqField(formData, 'reason'),
      occurredAt: reqField(formData, 'occurredAt'),
      idempotencyKey: reqField(formData, 'idempotencyKey'),
      expectedRequestVersion: reqField(formData, 'expectedRequestVersion'),
      expectedLocationVersion: reqField(formData, 'expectedLocationVersion'),
    });
    revalidateLocalExpensePaths();
    redirect(`/${locale}/finance/local-expenses?reviewed=${encodeURIComponent(result.requestNumber)}`);
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    return actionError(error);
  }
}

export async function saveLocationExpensePolicyAction(
  locationId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:inventory');
  if (!actor || (actor.role !== 'OWNER' && actor.role !== 'ADMIN')) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  try {
    await saveLocationExpensePolicy(actor, {
      locationId,
      isActive: boolField(formData, 'isActive'),
      allowedCategories: formData.getAll('allowedCategories').filter((value): value is string => typeof value === 'string') as never,
      maxImmediateAmount: reqField(formData, 'maxImmediateAmount'),
      receiptRequiredAbove: reqField(formData, 'receiptRequiredAbove'),
      expectedLocationVersion: reqField(formData, 'expectedLocationVersion'),
    });
    revalidatePath(INVENTORY_PATH, 'page');
    revalidateLocalExpensePaths();
    redirect(`/${locale}/admin/records/inventory/locations/${locationId}`);
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    return actionError(error);
  }
}
