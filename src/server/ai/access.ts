import 'server-only';
import type { AiPendingActionType, Role } from '@prisma/client';
import { can, type Capability } from '@/lib/rbac';
import { AI_ASSISTANT_TOOLS } from './tool-definitions';

const TOOL_CAPABILITIES: Record<string, Capability> = {
  sales_summary: 'view:sales',
  product_buyers: 'view:customers',
  search_orders: 'view:sales',
  order_details: 'view:sales',
  inventory_summary: 'view:inventory',
  expense_summary: 'view:financial',
  search_customers: 'view:customers',
  prepare_create_customer: 'manage:customers',
  prepare_create_order: 'manage:orders',
  prepare_create_expense: 'manage:finance',
  prepare_create_purchase: 'manage:finance',
  prepare_update_order_status: 'manage:orders',
  prepare_update_customer: 'manage:customers',
  prepare_update_party: 'manage:finance',
  prepare_adjust_inventory: 'manage:inventory',
  prepare_create_roast_batch: 'manage:batches',
  prepare_record_payment: 'manage:finance',
  prepare_record_refund: 'manage:finance',
  prepare_reverse_finance_record: 'manage:finance',
  prepare_reclassify_spend: 'manage:finance',
  prepare_dashboard_draft: 'manage:dashboards',
};

const ACTION_CAPABILITIES: Partial<Record<AiPendingActionType, Capability>> = {
  CREATE_CUSTOMER: 'manage:customers',
  CREATE_ORDER: 'manage:orders',
  CREATE_EXPENSE: 'manage:finance',
  CREATE_PURCHASE: 'manage:finance',
  UPDATE_ORDER_STATUS: 'manage:orders',
  UPDATE_CUSTOMER: 'manage:customers',
  UPDATE_PARTY: 'manage:finance',
  ADJUST_INVENTORY: 'manage:inventory',
  CREATE_ROAST_BATCH: 'manage:batches',
  RECORD_PAYMENT: 'manage:finance',
  RECORD_REFUND: 'manage:finance',
  REVERSE_RECORD: 'manage:finance',
  RECLASSIFY_SPEND: 'manage:finance',
  CREATE_DASHBOARD_DRAFT: 'manage:dashboards',
};

export function assistantToolsForRole(role: Role) {
  return AI_ASSISTANT_TOOLS.filter((tool) => can(role, TOOL_CAPABILITIES[tool.name]));
}

export function assertAssistantToolAllowed(role: Role, toolName: string): void {
  const capability = TOOL_CAPABILITIES[toolName];
  if (!capability || !can(role, capability)) throw new Error('ai_tool_forbidden');
}

export function canExecuteAssistantAction(role: Role, type: AiPendingActionType): boolean {
  const capability = ACTION_CAPABILITIES[type];
  return Boolean(capability && can(role, capability));
}
