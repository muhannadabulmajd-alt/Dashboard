-- Governed Inventory V2 receipt and packing actions for web AI and Telegram.

ALTER TYPE "AiPendingActionType" ADD VALUE IF NOT EXISTS 'RECEIVE_STOCK';
ALTER TYPE "AiPendingActionType" ADD VALUE IF NOT EXISTS 'PACK_FINISHED_GOODS';
