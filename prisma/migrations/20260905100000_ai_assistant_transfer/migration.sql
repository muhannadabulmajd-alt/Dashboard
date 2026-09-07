-- Add governed finance transfers to the shared AI confirmation pipeline.

ALTER TYPE "AiPendingActionType" ADD VALUE IF NOT EXISTS 'CREATE_TRANSFER';
