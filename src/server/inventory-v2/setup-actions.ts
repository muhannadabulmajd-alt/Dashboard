'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ZodError } from 'zod';
import { requireCap, reqField, optField, type ActionState } from '@/server/records/shared';
import {
  replaceUserLocationAccess,
  saveInventoryLocationPolicy,
  saveInventoryVariancePolicy,
  saveStockLocation,
  UserLocationAccessSetupSchema,
} from './setup';
import { bootstrapFinishedGoodsDefinitions } from './finished-goods-bootstrap';

const INVENTORY_PATH = '/[locale]/(dashboard)/admin/records/inventory';
const USER_PATH = '/[locale]/(dashboard)/admin/users';

function boolField(formData: FormData, key: string): boolean {
  return formData.get(key) === 'on' || formData.get(key) === 'true';
}

function actionError(error: unknown): ActionState {
  if (error instanceof ZodError) {
    return { error: error.issues[0]?.message || 'invalid' };
  }
  return { error: error instanceof Error ? error.message.split(':')[0] : 'invalid' };
}

export async function saveStockLocationAction(
  locationId: string | null,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:inventory');
  if (!actor) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  try {
    const location = await saveStockLocation(actor, {
      id: locationId ?? undefined,
      branchId: reqField(formData, 'branchId'),
      code: reqField(formData, 'code'),
      nameEn: reqField(formData, 'nameEn'),
      nameAr: reqField(formData, 'nameAr'),
      type: reqField(formData, 'type') as never,
      isActive: boolField(formData, 'isActive'),
      isCentralFulfillment: boolField(formData, 'isCentralFulfillment'),
    });
    revalidatePath(INVENTORY_PATH, 'page');
    redirect(`/${locale}/admin/records/inventory/locations/${location.id}`);
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    return actionError(error);
  }
}

export async function saveInventoryLocationPolicyAction(
  inventoryItemId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:inventory');
  if (!actor) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  try {
    await saveInventoryLocationPolicy(actor, {
      inventoryItemId,
      locationId: reqField(formData, 'locationId'),
      reorderPoint: optField(formData, 'reorderPoint'),
      targetLevel: optField(formData, 'targetLevel'),
      canSell: boolField(formData, 'canSell'),
      canProduce: boolField(formData, 'canProduce'),
      isActive: boolField(formData, 'isActive'),
      expectedLocationVersion: reqField(formData, 'expectedLocationVersion'),
    });
    revalidatePath(INVENTORY_PATH, 'page');
    revalidatePath(USER_PATH, 'page');
    redirect(`/${locale}/admin/records/inventory/${inventoryItemId}`);
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    return actionError(error);
  }
}

export async function saveInventoryVariancePolicyAction(
  locationId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:inventory');
  if (!actor || (actor.role !== 'OWNER' && actor.role !== 'ADMIN')) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  try {
    await saveInventoryVariancePolicy(actor, {
      locationId,
      isActive: boolField(formData, 'isActive'),
      openingBalanceAccountCode: optField(formData, 'openingBalanceAccountCode'),
      inventoryGainAccountCode: optField(formData, 'inventoryGainAccountCode'),
      inventoryLossAccountCode: optField(formData, 'inventoryLossAccountCode'),
      expectedLocationVersion: reqField(formData, 'expectedLocationVersion'),
    });
    revalidatePath(INVENTORY_PATH, 'page');
    redirect(`/${locale}/admin/records/inventory/locations/${locationId}`);
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    return actionError(error);
  }
}

export async function replaceUserLocationAccessAction(
  userId: string,
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:users');
  if (!actor) return { error: 'forbidden' };
  const locale = reqField(formData, 'locale') || 'ar';
  try {
    const parsed = UserLocationAccessSetupSchema.parse({
      userId,
      defaultLocationId: optField(formData, 'defaultLocationId'),
      accesses: JSON.parse(reqField(formData, 'accesses') || '[]'),
    });
    await replaceUserLocationAccess(actor, parsed);
    revalidatePath(USER_PATH, 'page');
    redirect(`/${locale}/admin/users/${userId}/edit`);
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    return actionError(error);
  }
}

export async function bootstrapFinishedGoodsAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireCap('manage:inventory');
  if (!actor) return { error: 'forbidden' };
  try {
    const result = await bootstrapFinishedGoodsDefinitions(actor, {
      idempotencyKey: reqField(formData, 'idempotencyKey'),
      expectedCentralLocationVersion: reqField(formData, 'expectedCentralLocationVersion'),
    });
    revalidatePath(INVENTORY_PATH, 'page');
    return {
      ok: true,
      recordNumber: String(result.createdItemCount),
    };
  } catch (error) {
    return actionError(error);
  }
}
