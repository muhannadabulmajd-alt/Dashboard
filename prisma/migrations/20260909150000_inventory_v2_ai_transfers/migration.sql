-- Governed Inventory V2 transfer dispatch and receipt actions for web AI and Telegram.

ALTER TYPE "AiPendingActionType" ADD VALUE IF NOT EXISTS 'DISPATCH_STOCK_TRANSFER';
ALTER TYPE "AiPendingActionType" ADD VALUE IF NOT EXISTS 'RECEIVE_STOCK_TRANSFER';
