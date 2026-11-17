-- AlterTable
ALTER TABLE "finance"."CommissionCalculation" ADD COLUMN     "engineAmount" DECIMAL(18,2),
ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "reconcileSummary" JSONB,
ADD COLUMN     "statementId" TEXT;

-- AlterTable
ALTER TABLE "finance"."TripGuest" ADD COLUMN     "country" TEXT;

-- CreateTable
CREATE TABLE "finance"."CasinoStatement" (
    "id" TEXT NOT NULL,
    "casinoId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IMPORTED',
    "totals" JSONB NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedBy" TEXT,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "CasinoStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."StatementLine" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "rowNo" INTEGER NOT NULL,
    "crmNo" INTEGER,
    "playerRef" TEXT,
    "name" TEXT,
    "playedOn" TIMESTAMP(3),
    "netLoss" DECIMAL(18,2) NOT NULL,
    "rolling" DECIMAL(18,2),
    "tripGuestId" TEXT,
    "match" TEXT NOT NULL,
    "issue" TEXT,
    "resultId" TEXT,

    CONSTRAINT "StatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CasinoStatement_casinoId_period_idx" ON "finance"."CasinoStatement"("casinoId", "period");

-- CreateIndex
CREATE INDEX "StatementLine_statementId_idx" ON "finance"."StatementLine"("statementId");

-- AddForeignKey
ALTER TABLE "finance"."StatementLine" ADD CONSTRAINT "StatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "finance"."CasinoStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
