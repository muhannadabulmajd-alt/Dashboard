-- Statement matching archives superseded Wayl receipts. Keep the historical
-- provider settlement equal to the active cash entries that still belong to it.
DO $$
DECLARE
  settlement_id TEXT;
  settlement_account_id TEXT;
  previous_gross INTEGER;
  previous_received INTEGER;
  fees_offset INTEGER;
  active_cash BIGINT;
  actor_id TEXT;
BEGIN
  SELECT
    settlement.id,
    settlement."accountId",
    settlement."grossCleared",
    settlement."amountReceived",
    settlement."feesOffset"
  INTO
    settlement_id,
    settlement_account_id,
    previous_gross,
    previous_received,
    fees_offset
  FROM "ProviderSettlement" settlement
  WHERE settlement.reference = 'RECON-20260712-WAYL'
  FOR UPDATE;

  IF settlement_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(entry.amount), 0)
  INTO active_cash
  FROM "FinanceEntry" entry
  WHERE entry."providerSettlementId" = settlement_id
    AND entry.type = 'PAYMENT_IN'
    AND entry."accountId" = settlement_account_id
    AND entry."archivedAt" IS NULL
    AND entry."reversedAt" IS NULL
    AND entry."reversalOfId" IS NULL;

  IF active_cash > 2147483647 THEN
    RAISE EXCEPTION 'Active Wayl settlement cash exceeds the supported integer range';
  END IF;

  IF previous_received <> active_cash::INTEGER
     OR previous_gross <> active_cash::INTEGER + fees_offset THEN
    SELECT id
    INTO actor_id
    FROM "User"
    WHERE role IN ('OWNER', 'ADMIN')
    ORDER BY "createdAt"
    LIMIT 1;

    UPDATE "ProviderSettlement"
    SET
      "amountReceived" = active_cash::INTEGER,
      "grossCleared" = active_cash::INTEGER + fees_offset
    WHERE id = settlement_id;

    INSERT INTO "AuditLog" (
      id,
      "userId",
      action,
      entity,
      "entityId",
      metadata
    )
    VALUES (
      'audit-reconcile-legacy-wayl-settlement-20260728',
      actor_id,
      'RECONCILE_PROVIDER_SETTLEMENT',
      'ProviderSettlement',
      settlement_id,
      jsonb_build_object(
        'reason', 'Statement-matched receipts were archived and replaced by exact Wayl statement entries.',
        'before', jsonb_build_object(
          'grossCleared', previous_gross,
          'amountReceived', previous_received,
          'feesOffset', fees_offset
        ),
        'after', jsonb_build_object(
          'grossCleared', active_cash::INTEGER + fees_offset,
          'amountReceived', active_cash::INTEGER,
          'feesOffset', fees_offset
        ),
        'statementPayoutsRemainSeparate', true
      )
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
