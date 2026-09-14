-- Governed returned-goods and stock-document reversal actions for web AI and Telegram.

ALTER TYPE "AiPendingActionType" ADD VALUE IF NOT EXISTS 'RETURN_TO_QUARANTINE';
ALTER TYPE "AiPendingActionType" ADD VALUE IF NOT EXISTS 'DISPOSE_RETURNED_GOODS';
ALTER TYPE "AiPendingActionType" ADD VALUE IF NOT EXISTS 'REVERSE_STOCK_DOCUMENT';
