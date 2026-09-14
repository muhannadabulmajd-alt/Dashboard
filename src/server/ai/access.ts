import 'server-only';
import type { AiPendingActionType, Role } from '@prisma/client';
import { can, type Capability } from '@/lib/rbac';
import { canManageExistingCustomer } from '@/server/records/customer-policy';
import { AI_ASSISTANT_TOOLS } from './tool-definitions';

const TOOL_CAPABILITIES: Record<string, Capability> = {
  sales_summary: 'view:sales',
  product_buyers: 'view:customers',
  search_orders: 'view:sales',
  order_details: 'view:sales',
  inventory_summary: 'view:inventory',
  expense_summary: 'view:financial',
  finance_overview: 'view:financial',
  customer_insights: 'view:customers',
  delivery_summary: 'view:fulfillment',
  roastery_summary: 'view:roastery',
  inventory_recommendations: 'view:inventory',
  demand_forecast: 'view:sales',
  operational_alerts: 'view:dashboard',
  search_customers: 'view:customers',
  prepare_create_customer: 'manage:customers',
  prepare_create_order: 'manage:orders',
  prepare_create_expense: 'manage:finance',
  prepare_create_purchase: 'manage:finance',
  prepare_create_transfer: 'manage:finance',
  prepare_update_order_status: 'manage:orders',
  prepare_update_customer: 'manage:customers',
  prepare_update_party: 'manage:finance',
  prepare_adjust_inventory: 'manage:inventory',
  prepare_receive_stock: 'manage:inventory',
  prepare_pack_finished_goods: 'manage:inventory',
  prepare_dispatch_stock_transfer: 'manage:inventory',
  prepare_receive_stock_transfer: 'manage:inventory',
  prepare_record_local_expense: 'record:local-expense',
  prepare_return_to_quarantine: 'manage:inventory',
  prepare_dispose_returned_goods: 'manage:inventory',
  prepare_reverse_stock_document: 'manage:inventory',
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
  CREATE_TRANSFER: 'manage:finance',
  UPDATE_ORDER_STATUS: 'manage:orders',
  UPDATE_CUSTOMER: 'manage:customers',
  UPDATE_PARTY: 'manage:finance',
  ADJUST_INVENTORY: 'manage:inventory',
  RECEIVE_STOCK: 'manage:inventory',
  PACK_FINISHED_GOODS: 'manage:inventory',
  DISPATCH_STOCK_TRANSFER: 'manage:inventory',
  RECEIVE_STOCK_TRANSFER: 'manage:inventory',
  RECORD_LOCAL_EXPENSE: 'record:local-expense',
  RETURN_TO_QUARANTINE: 'manage:inventory',
  DISPOSE_RETURNED_GOODS: 'manage:inventory',
  REVERSE_STOCK_DOCUMENT: 'manage:inventory',
  CREATE_ROAST_BATCH: 'manage:batches',
  RECORD_PAYMENT: 'manage:finance',
  RECORD_REFUND: 'manage:finance',
  REVERSE_RECORD: 'manage:finance',
  RECLASSIFY_SPEND: 'manage:finance',
  CREATE_DASHBOARD_DRAFT: 'manage:dashboards',
};

const OWNER_ADMIN_TOOLS = new Set([
  'prepare_receive_stock',
  'prepare_dispatch_stock_transfer',
  'prepare_dispose_returned_goods',
  'prepare_reverse_stock_document',
]);
const OWNER_ADMIN_ACTIONS = new Set<AiPendingActionType>([
  'RECEIVE_STOCK',
  'DISPATCH_STOCK_TRANSFER',
  'DISPOSE_RETURNED_GOODS',
  'REVERSE_STOCK_DOCUMENT',
]);
const CENTRAL_CUSTOMER_TOOLS = new Set(['prepare_update_customer']);
const CENTRAL_CUSTOMER_ACTIONS = new Set<AiPendingActionType>(['UPDATE_CUSTOMER']);

function ownerAdmin(role: Role): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export function assistantToolsForRole(role: Role) {
  return AI_ASSISTANT_TOOLS.filter((tool) => (
    can(role, TOOL_CAPABILITIES[tool.name])
    && (!OWNER_ADMIN_TOOLS.has(tool.name) || ownerAdmin(role))
    && (!CENTRAL_CUSTOMER_TOOLS.has(tool.name) || canManageExistingCustomer(role))
  ));
}

export function assertAssistantToolAllowed(role: Role, toolName: string): void {
  const capability = TOOL_CAPABILITIES[toolName];
  if (
    !capability
    || !can(role, capability)
    || (OWNER_ADMIN_TOOLS.has(toolName) && !ownerAdmin(role))
    || (CENTRAL_CUSTOMER_TOOLS.has(toolName) && !canManageExistingCustomer(role))
  ) throw new Error('ai_tool_forbidden');
}

export function canExecuteAssistantAction(role: Role, type: AiPendingActionType): boolean {
  const capability = ACTION_CAPABILITIES[type];
  return Boolean(
    capability
    && can(role, capability)
    && (!OWNER_ADMIN_ACTIONS.has(type) || ownerAdmin(role))
    && (!CENTRAL_CUSTOMER_ACTIONS.has(type) || canManageExistingCustomer(role)),
  );
}
