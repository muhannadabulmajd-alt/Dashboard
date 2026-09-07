import 'server-only';

export const COMMAND_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 60_000,
} as const;

export const ORDER_CREATE_TRANSACTION_CHECKPOINTS = [
  'precondition',
  'order_number',
  'customer',
  'inventory_readiness',
  'order_insert',
  'stock_sync',
  'finance_sync',
  'customer_stats',
  'commit_hook',
] as const;

export type OrderCreateTransactionCheckpoint =
  (typeof ORDER_CREATE_TRANSACTION_CHECKPOINTS)[number];

export const CENTRAL_RECORD_TRANSACTION_CHECKPOINTS = [
  'precondition',
  'party',
  'finance_entry',
  'line_effects',
  'payment',
  'audit',
  'cost_sync',
  'commit_hook',
] as const;

export type CentralRecordTransactionCheckpoint =
  (typeof CENTRAL_RECORD_TRANSACTION_CHECKPOINTS)[number];
