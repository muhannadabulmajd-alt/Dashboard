INSERT INTO "Setting" ("key", "value", "updatedAt")
VALUES (
  'order_payment_invariant_started_at',
  CURRENT_TIMESTAMP::text,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
