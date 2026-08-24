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
};

const ACTION_CAPABILITIES: Record<AiPendingActionType, Capability> = {
  CREATE_CUSTOMER: 'manage:customers',
  CREATE_ORDER: 'manage:orders',
  CREATE_EXPENSE: 'manage:finance',
  CREATE_PURCHASE: 'manage:finance',
  UPDATE_ORDER_STATUS: 'manage:orders',
};

export function assistantToolsForRole(role: Role) {
  return AI_ASSISTANT_TOOLS.filter((tool) => can(role, TOOL_CAPABILITIES[tool.name]));
}

export function assertAssistantToolAllowed(role: Role, toolName: string): void {
  const capability = TOOL_CAPABILITIES[toolName];
  if (!capability || !can(role, capability)) throw new Error('ai_tool_forbidden');
}

export function canExecuteAssistantAction(role: Role, type: AiPendingActionType): boolean {
  return can(role, ACTION_CAPABILITIES[type]);
}
