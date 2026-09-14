import { z } from 'zod';
import { LOCAL_OPEX_CATEGORY_TYPES } from '@/lib/enums';

const id = z.string().trim().min(1).max(191);
const idempotencyKey = z.string().trim().min(8).max(200);
const quantity = z.coerce.number().positive().refine(
  (value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-8,
  'quantity_precision',
);
const nonNegativeQuantity = z.coerce.number().nonnegative().refine(
  (value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-8,
  'quantity_precision',
);
const stockVersion = z.coerce.number().int().positive();
const optionalText = z.string().trim().max(500).optional();

const ReceiveStockSupplierSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(50).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  address: z.string().trim().max(500).optional(),
  notes: optionalText,
}).strict();

export const ReceiveStockCommandSchema = z.object({
  inventoryItemId: id,
  locationId: id,
  quantity,
  unitCost: nonNegativeQuantity,
  occurredAt: z.coerce.date(),
  bestBefore: z.coerce.date().optional(),
  supplierLot: optionalText,
  reference: optionalText,
  notes: optionalText,
  paymentMode: z.enum(['CREDIT', 'PAID']),
  accountId: id.optional(),
  partyId: id.optional(),
  newSupplier: ReceiveStockSupplierSchema.optional(),
  dueDate: z.coerce.date().optional(),
  idempotencyKey,
  expectedLocationVersion: stockVersion,
}).superRefine((value, context) => {
  if (value.paymentMode === 'PAID' && !value.accountId) {
    context.addIssue({ code: 'custom', path: ['accountId'], message: 'payment_account_required' });
  }
  if (Boolean(value.partyId) === Boolean(value.newSupplier)) {
    context.addIssue({ code: 'custom', path: ['partyId'], message: 'supplier_source_required' });
  }
});

export const ReserveStockCommandSchema = z.object({
  inventoryItemId: id,
  locationId: id,
  orderId: id,
  orderLineId: id,
  quantity,
  expiresAt: z.coerce.date().optional(),
  idempotencyKey,
  expectedLocationVersion: stockVersion,
});

export const ConsumeReservationCommandSchema = z.object({
  reservationId: id,
  occurredAt: z.coerce.date(),
  idempotencyKey,
  expectedLocationVersion: stockVersion,
});

export const ReleaseReservationCommandSchema = z.object({
  reservationId: id,
  reason: z.string().trim().min(3).max(500),
  idempotencyKey,
  expectedLocationVersion: stockVersion,
});

export const TransferLineSchema = z.object({
  inventoryItemId: id,
  quantity,
});

export const DispatchTransferCommandSchema = z.object({
  sourceLocationId: id,
  destinationLocationId: id,
  lines: z.array(TransferLineSchema).min(1).max(100),
  occurredAt: z.coerce.date(),
  expectedAt: z.coerce.date().optional(),
  notes: optionalText,
  idempotencyKey,
  expectedSourceVersion: stockVersion,
  expectedTransitVersion: stockVersion,
});

export const TransferDiscrepancySchema = z.object({
  inventoryItemId: id,
  type: z.enum(['SHORTAGE', 'DAMAGE', 'EXCESS']),
  quantity,
  notes: z.string().trim().min(3).max(500),
});

export const ReceiveTransferCommandSchema = z.object({
  stockDocumentId: id,
  destinationLocationId: id,
  lines: z.array(TransferLineSchema).max(100).default([]),
  discrepancies: z.array(TransferDiscrepancySchema).max(100).default([]),
  occurredAt: z.coerce.date(),
  notes: optionalText,
  idempotencyKey,
  expectedTransitVersion: stockVersion,
  expectedDestinationVersion: stockVersion,
  expectedDocumentVersion: stockVersion,
}).superRefine((value, context) => {
  if (!value.lines.length && !value.discrepancies.length) {
    context.addIssue({ code: 'custom', path: ['lines'], message: 'transfer_receipt_empty' });
  }
  const discrepancyItemIds = value.discrepancies.map((row) => row.inventoryItemId);
  if (new Set(discrepancyItemIds).size !== discrepancyItemIds.length) {
    context.addIssue({ code: 'custom', path: ['discrepancies'], message: 'transfer_discrepancy_duplicate_item' });
  }
});

export const ResolveStockDiscrepancyCommandSchema = z.object({
  stockDiscrepancyId: id,
  decision: z.enum(['APPROVE', 'REJECT']),
  resolution: z.string().trim().min(3).max(500),
  approvedUnitCost: quantity.optional(),
  occurredAt: z.coerce.date(),
  idempotencyKey,
  expectedDiscrepancyVersion: stockVersion,
  expectedLocationVersion: stockVersion,
}).superRefine((value, context) => {
  if (value.decision === 'REJECT' && value.approvedUnitCost !== undefined) {
    context.addIssue({ code: 'custom', path: ['approvedUnitCost'], message: 'discrepancy_unit_cost_not_allowed' });
  }
});

export const ReverseStockDocumentCommandSchema = z.object({
  stockDocumentId: id,
  confirmationDocumentNumber: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(3).max(500),
  occurredAt: z.coerce.date(),
  idempotencyKey,
  expectedDocumentVersion: stockVersion,
  expectedLocationVersions: z.array(z.object({
    locationId: id,
    stockVersion,
  })).min(1).max(10),
}).superRefine((value, context) => {
  const locationIds = value.expectedLocationVersions.map((row) => row.locationId);
  if (new Set(locationIds).size !== locationIds.length) {
    context.addIssue({ code: 'custom', path: ['expectedLocationVersions'], message: 'location_version_duplicate' });
  }
});

export const SubmitInventoryCountCommandSchema = z.object({
  locationId: id,
  kind: z.enum(['ROUTINE', 'OPENING']).default('ROUTINE'),
  countedAt: z.coerce.date(),
  reason: z.string().trim().min(3).max(500),
  openingAttestation: z.boolean().default(false),
  lines: z.array(z.object({
    inventoryItemId: id,
    countedQuantity: nonNegativeQuantity,
    notes: optionalText,
  })).min(1).max(1000),
  idempotencyKey,
  expectedLocationVersion: stockVersion,
}).superRefine((value, context) => {
  const itemIds = value.lines.map((line) => line.inventoryItemId);
  if (new Set(itemIds).size !== itemIds.length) {
    context.addIssue({ code: 'custom', path: ['lines'], message: 'count_duplicate_item' });
  }
  if (value.kind === 'OPENING' && !value.openingAttestation) {
    context.addIssue({ code: 'custom', path: ['openingAttestation'], message: 'opening_attestation_required' });
  }
});

export const ApproveInventoryCountCommandSchema = z.object({
  inventoryCountId: id,
  reason: z.string().trim().min(3).max(500),
  occurredAt: z.coerce.date(),
  idempotencyKey,
  expectedLocationVersion: stockVersion,
  expectedCountVersion: stockVersion,
});

export const RejectInventoryCountCommandSchema = z.object({
  inventoryCountId: id,
  reason: z.string().trim().min(3).max(500),
  idempotencyKey,
  expectedCountVersion: stockVersion,
});

export const ReviewReplenishmentRequestCommandSchema = z.object({
  replenishmentRequestId: id,
  decision: z.enum(['START', 'CANCEL']),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey,
  expectedRequestVersion: stockVersion,
});

export const PackFinishedGoodsCommandSchema = z.object({
  locationId: id,
  productId: id,
  outputInventoryItemId: id,
  recipeVersionId: id,
  outputQuantity: quantity,
  rejectedQuantity: nonNegativeQuantity.default(0),
  packedAt: z.coerce.date(),
  bestBefore: z.coerce.date().optional(),
  notes: optionalText,
  idempotencyKey,
  expectedLocationVersion: stockVersion,
});

export const RoastProductionCommandSchema = z.object({
  batchNumber: z.string().trim().min(2).max(100),
  locationId: id,
  greenInventoryItemId: id,
  roastedInventoryItemId: id,
  origin: z.string().trim().min(2).max(200),
  roastLevel: optionalText,
  greenInputGrams: z.coerce.number().int().positive(),
  roastedOutputGrams: z.coerce.number().int().positive(),
  abnormalLossGrams: z.coerce.number().int().nonnegative().default(0),
  roastDate: z.coerce.date(),
  qcScore: z.coerce.number().min(0).max(100).optional(),
  qcNotes: optionalText,
  idempotencyKey,
  expectedLocationVersion: stockVersion,
}).superRefine((value, context) => {
  if (value.roastedOutputGrams > value.greenInputGrams) {
    context.addIssue({ code: 'custom', path: ['roastedOutputGrams'], message: 'roast_output_exceeds_input' });
  }
  const shrinkage = value.greenInputGrams - value.roastedOutputGrams;
  if (value.abnormalLossGrams > shrinkage) {
    context.addIssue({ code: 'custom', path: ['abnormalLossGrams'], message: 'abnormal_loss_exceeds_shrinkage' });
  }
});

export const ReturnToQuarantineCommandSchema = z.object({
  orderLineId: id,
  quantity,
  occurredAt: z.coerce.date(),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey,
  expectedFulfillmentVersion: stockVersion,
  expectedQuarantineVersion: stockVersion,
});

export const DisposeReturnedGoodsCommandSchema = z.object({
  returnDocumentId: id,
  inventoryItemId: id,
  quantity,
  disposition: z.enum(['RESTOCK', 'REPACK', 'RETURN_TO_SUPPLIER', 'WASTE']),
  destinationLocationId: id.optional(),
  supplierPartyId: id.optional(),
  occurredAt: z.coerce.date(),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey,
  expectedQuarantineVersion: stockVersion,
  expectedDestinationVersion: stockVersion.optional(),
  expectedReturnDocumentVersion: stockVersion,
}).superRefine((value, context) => {
  const needsDestination = value.disposition === 'RESTOCK' || value.disposition === 'REPACK';
  if (needsDestination && !value.destinationLocationId) {
    context.addIssue({ code: 'custom', path: ['destinationLocationId'], message: 'destination_required' });
  }
  if (needsDestination && !value.expectedDestinationVersion) {
    context.addIssue({ code: 'custom', path: ['expectedDestinationVersion'], message: 'destination_version_required' });
  }
  if (!needsDestination && value.destinationLocationId) {
    context.addIssue({ code: 'custom', path: ['destinationLocationId'], message: 'destination_not_allowed' });
  }
  if (value.disposition === 'RETURN_TO_SUPPLIER' && !value.supplierPartyId) {
    context.addIssue({ code: 'custom', path: ['supplierPartyId'], message: 'supplier_required' });
  }
  if (value.disposition !== 'RETURN_TO_SUPPLIER' && value.supplierPartyId) {
    context.addIssue({ code: 'custom', path: ['supplierPartyId'], message: 'supplier_not_allowed' });
  }
});

const localExpenseReceipt = z.object({
  bytes: z.instanceof(Uint8Array),
  fileName: z.string().trim().min(1).max(120),
  declaredMimeType: z.string().trim().max(100).optional(),
});

export const RecordLocalExpenseCommandSchema = z.object({
  locationId: id,
  amount: z.coerce.number().int().positive().max(2_000_000_000),
  categoryType: z.enum(LOCAL_OPEX_CATEGORY_TYPES),
  description: z.string().trim().min(3).max(500),
  occurredAt: z.coerce.date(),
  receipt: localExpenseReceipt.optional(),
  noReceiptReason: z.string().trim().min(3).max(500).optional(),
  idempotencyKey,
  expectedLocationVersion: stockVersion,
}).superRefine((value, context) => {
  if (!value.receipt && !value.noReceiptReason) {
    context.addIssue({ code: 'custom', path: ['receipt'], message: 'expense_evidence_required' });
  }
  if (value.receipt && value.noReceiptReason) {
    context.addIssue({ code: 'custom', path: ['noReceiptReason'], message: 'expense_evidence_conflict' });
  }
});

export const ReviewLocalExpenseCommandSchema = z.object({
  requestId: id,
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().min(3).max(500),
  occurredAt: z.coerce.date(),
  idempotencyKey,
  expectedRequestVersion: stockVersion,
  expectedLocationVersion: stockVersion,
});

export const LocationExpensePolicySchema = z.object({
  locationId: id,
  isActive: z.coerce.boolean(),
  allowedCategories: z.array(z.enum(LOCAL_OPEX_CATEGORY_TYPES)).max(LOCAL_OPEX_CATEGORY_TYPES.length),
  maxImmediateAmount: z.coerce.number().int().nonnegative().max(2_000_000_000),
  receiptRequiredAbove: z.coerce.number().int().nonnegative().max(2_000_000_000),
  expectedLocationVersion: stockVersion,
}).superRefine((value, context) => {
  if (value.isActive && !value.allowedCategories.length) {
    context.addIssue({ code: 'custom', path: ['allowedCategories'], message: 'expense_categories_required' });
  }
});

export type ReceiveStockCommandInput = z.input<typeof ReceiveStockCommandSchema>;
export type ReserveStockCommandInput = z.input<typeof ReserveStockCommandSchema>;
export type ConsumeReservationCommandInput = z.input<typeof ConsumeReservationCommandSchema>;
export type ReleaseReservationCommandInput = z.input<typeof ReleaseReservationCommandSchema>;
export type DispatchTransferCommandInput = z.input<typeof DispatchTransferCommandSchema>;
export type ReceiveTransferCommandInput = z.input<typeof ReceiveTransferCommandSchema>;
export type ResolveStockDiscrepancyCommandInput = z.input<typeof ResolveStockDiscrepancyCommandSchema>;
export type ReverseStockDocumentCommandInput = z.input<typeof ReverseStockDocumentCommandSchema>;
export type SubmitInventoryCountCommandInput = z.input<typeof SubmitInventoryCountCommandSchema>;
export type ApproveInventoryCountCommandInput = z.input<typeof ApproveInventoryCountCommandSchema>;
export type RejectInventoryCountCommandInput = z.input<typeof RejectInventoryCountCommandSchema>;
export type ReviewReplenishmentRequestCommandInput = z.input<typeof ReviewReplenishmentRequestCommandSchema>;
export type PackFinishedGoodsCommandInput = z.input<typeof PackFinishedGoodsCommandSchema>;
export type RoastProductionCommandInput = z.input<typeof RoastProductionCommandSchema>;
export type ReturnToQuarantineCommandInput = z.input<typeof ReturnToQuarantineCommandSchema>;
export type DisposeReturnedGoodsCommandInput = z.input<typeof DisposeReturnedGoodsCommandSchema>;
export type RecordLocalExpenseCommandInput = z.input<typeof RecordLocalExpenseCommandSchema>;
export type ReviewLocalExpenseCommandInput = z.input<typeof ReviewLocalExpenseCommandSchema>;
export type LocationExpensePolicyInput = z.input<typeof LocationExpensePolicySchema>;
