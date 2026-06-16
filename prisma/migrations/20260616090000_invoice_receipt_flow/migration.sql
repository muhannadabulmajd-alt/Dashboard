-- Invoice / receipt flow: selling units, creator snapshots and payment methods.
ALTER TABLE "Product" ADD COLUMN "sellUnit" TEXT NOT NULL DEFAULT 'unit';

ALTER TABLE "Order" ADD COLUMN "createdById" TEXT;

ALTER TABLE "OrderLine" ADD COLUMN "unitLabel" TEXT NOT NULL DEFAULT 'unit';

ALTER TABLE "FinanceEntry" ADD COLUMN "paymentMethod" TEXT;

CREATE INDEX "Order_createdById_idx" ON "Order"("createdById");
CREATE INDEX "FinanceEntry_paymentMethod_idx" ON "FinanceEntry"("paymentMethod");

ALTER TABLE "Order"
ADD CONSTRAINT "Order_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
