-- Dashboard Builder persistence.
CREATE TYPE "DashboardVisibility" AS ENUM ('PRIVATE', 'SHARED');

CREATE TABLE "Dashboard" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "ownerId" TEXT NOT NULL,
  "visibility" "DashboardVisibility" NOT NULL DEFAULT 'PRIVATE',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB NOT NULL,
  "draftConfig" JSONB,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Dashboard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DashboardShare" (
  "id" TEXT NOT NULL,
  "dashboardId" TEXT NOT NULL,
  "userId" TEXT,
  "role" "Role",
  "canEdit" BOOLEAN NOT NULL DEFAULT false,
  "canExport" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DashboardShare_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Dashboard_ownerId_idx" ON "Dashboard"("ownerId");
CREATE INDEX "Dashboard_visibility_idx" ON "Dashboard"("visibility");
CREATE INDEX "Dashboard_deletedAt_idx" ON "Dashboard"("deletedAt");
CREATE INDEX "Dashboard_isPinned_idx" ON "Dashboard"("isPinned");
CREATE INDEX "DashboardShare_userId_idx" ON "DashboardShare"("userId");
CREATE INDEX "DashboardShare_role_idx" ON "DashboardShare"("role");
CREATE UNIQUE INDEX "DashboardShare_dashboardId_userId_key" ON "DashboardShare"("dashboardId", "userId");
CREATE UNIQUE INDEX "DashboardShare_dashboardId_role_key" ON "DashboardShare"("dashboardId", "role");

ALTER TABLE "Dashboard"
  ADD CONSTRAINT "Dashboard_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DashboardShare"
  ADD CONSTRAINT "DashboardShare_dashboardId_fkey"
  FOREIGN KEY ("dashboardId") REFERENCES "Dashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DashboardShare"
  ADD CONSTRAINT "DashboardShare_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
