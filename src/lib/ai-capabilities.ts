import type { AiPendingActionType } from '@prisma/client';
import { z } from 'zod';

export const AI_CAPABILITIES = [
  'READS',
  'ORDERS_CUSTOMERS',
  'SPENDING_PURCHASES',
  'OPERATIONS_PAYMENTS',
  'MEDIA_REPORTS',
  'AUTOMATIONS',
] as const;

export const AI_CAPABILITY_STATUSES = ['ENABLED', 'DISABLED', 'PAUSED'] as const;

export type AiCapability = (typeof AI_CAPABILITIES)[number];
export type AiCapabilityStatusValue = (typeof AI_CAPABILITY_STATUSES)[number];

export type AiCapabilityState = {
  capability: AiCapability;
  status: AiCapabilityStatusValue;
  failureCount: number;
  failureLimit: number;
  disabledReason: string | null;
  lastFailureAt: string | null;
  updatedAt: string | null;
};

export const AiCapabilityUpdateSchema = z.object({
  capability: z.enum(AI_CAPABILITIES),
  status: z.enum(AI_CAPABILITY_STATUSES),
  failureLimit: z.number().int().min(1).max(10),
  reason: z.string().trim().min(1).max(200).nullable().optional(),
}).strict();

export type AiCapabilityUpdate = z.infer<typeof AiCapabilityUpdateSchema>;

const TOOL_CAPABILITIES: Record<string, AiCapability> = {
  sales_summary: 'READS',
  product_buyers: 'READS',
  search_orders: 'READS',
  order_details: 'READS',
  inventory_summary: 'READS',
  expense_summary: 'READS',
  finance_overview: 'READS',
  customer_insights: 'READS',
  delivery_summary: 'READS',
  roastery_summary: 'READS',
  inventory_recommendations: 'READS',
  demand_forecast: 'READS',
  operational_alerts: 'READS',
  search_customers: 'READS',
  prepare_create_customer: 'ORDERS_CUSTOMERS',
  prepare_create_order: 'ORDERS_CUSTOMERS',
  prepare_update_order_status: 'ORDERS_CUSTOMERS',
  prepare_update_customer: 'ORDERS_CUSTOMERS',
  prepare_create_expense: 'SPENDING_PURCHASES',
  prepare_create_purchase: 'SPENDING_PURCHASES',
  prepare_create_transfer: 'SPENDING_PURCHASES',
  prepare_update_party: 'SPENDING_PURCHASES',
  prepare_reclassify_spend: 'SPENDING_PURCHASES',
  prepare_adjust_inventory: 'OPERATIONS_PAYMENTS',
  prepare_create_roast_batch: 'OPERATIONS_PAYMENTS',
  prepare_record_payment: 'OPERATIONS_PAYMENTS',
  prepare_record_refund: 'OPERATIONS_PAYMENTS',
  prepare_reverse_finance_record: 'OPERATIONS_PAYMENTS',
  prepare_dashboard_draft: 'MEDIA_REPORTS',
};

const ACTION_CAPABILITIES: Record<AiPendingActionType, readonly AiCapability[]> = {
  CREATE_CUSTOMER: ['ORDERS_CUSTOMERS'],
  CREATE_ORDER: ['ORDERS_CUSTOMERS'],
  CREATE_EXPENSE: ['SPENDING_PURCHASES'],
  CREATE_PURCHASE: ['SPENDING_PURCHASES'],
  CREATE_TRANSFER: ['SPENDING_PURCHASES'],
  UPDATE_ORDER_STATUS: ['ORDERS_CUSTOMERS'],
  UPDATE_CUSTOMER: ['ORDERS_CUSTOMERS'],
  UPDATE_PARTY: ['SPENDING_PURCHASES'],
  ADJUST_INVENTORY: ['OPERATIONS_PAYMENTS'],
  CREATE_ROAST_BATCH: ['OPERATIONS_PAYMENTS'],
  RECORD_PAYMENT: ['OPERATIONS_PAYMENTS'],
  RECORD_REFUND: ['OPERATIONS_PAYMENTS'],
  REVERSE_RECORD: ['OPERATIONS_PAYMENTS'],
  RECLASSIFY_SPEND: ['SPENDING_PURCHASES'],
  CREATE_DASHBOARD_DRAFT: ['MEDIA_REPORTS'],
  MULTI_ACTION_BUNDLE: [
    'ORDERS_CUSTOMERS',
    'SPENDING_PURCHASES',
    'OPERATIONS_PAYMENTS',
    'MEDIA_REPORTS',
  ],
};

export function aiCapabilityForTool(toolName: string): AiCapability | null {
  return TOOL_CAPABILITIES[toolName] ?? null;
}

export function aiCapabilitiesForAction(type: AiPendingActionType): readonly AiCapability[] {
  return ACTION_CAPABILITIES[type] ?? [];
}

export function defaultAiCapabilityState(capability: AiCapability): AiCapabilityState {
  return {
    capability,
    status: 'ENABLED',
    failureCount: 0,
    failureLimit: 1,
    disabledReason: null,
    lastFailureAt: null,
    updatedAt: null,
  };
}
