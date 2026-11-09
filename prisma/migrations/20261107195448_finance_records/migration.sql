-- AlterTable
ALTER TABLE "finance"."Casino" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "finance"."CommissionCalculation" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "reconciledBy" TEXT,
ADD COLUMN     "rejectReason" TEXT,
ADD COLUMN     "statementRef" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "finance"."ContractVersion" ADD COLUMN     "note" TEXT;

-- CreateTable
CREATE TABLE "finance"."Trip" (
    "id" TEXT NOT NULL,
    "casinoId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."TripGuest" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "crmNo" INTEGER NOT NULL,
    "guestName" TEXT NOT NULL,

    CONSTRAINT "TripGuest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."GamingResult" (
    "id" TEXT NOT NULL,
    "tripGuestId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "playedOn" TIMESTAMP(3) NOT NULL,
    "buyIn" DECIMAL(18,2),
    "cashOut" DECIMAL(18,2),
    "rolling" DECIMAL(18,2),
    "netLoss" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT,
    "enteredBy" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GamingResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."CommissionAdjustment" (
    "id" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "preparedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TripGuest_tripId_guestId_key" ON "finance"."TripGuest"("tripId", "guestId");

-- CreateIndex
CREATE INDEX "GamingResult_periodId_idx" ON "finance"."GamingResult"("periodId");

-- AddForeignKey
ALTER TABLE "finance"."Trip" ADD CONSTRAINT "Trip_casinoId_fkey" FOREIGN KEY ("casinoId") REFERENCES "finance"."Casino"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."TripGuest" ADD CONSTRAINT "TripGuest_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "finance"."Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."GamingResult" ADD CONSTRAINT "GamingResult_tripGuestId_fkey" FOREIGN KEY ("tripGuestId") REFERENCES "finance"."TripGuest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."GamingResult" ADD CONSTRAINT "GamingResult_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "finance"."CommissionPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."CommissionPeriod" ADD CONSTRAINT "CommissionPeriod_casinoId_fkey" FOREIGN KEY ("casinoId") REFERENCES "finance"."Casino"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."CommissionAdjustment" ADD CONSTRAINT "CommissionAdjustment_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "finance"."CommissionCalculation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."CommissionAdjustment" ADD CONSTRAINT "CommissionAdjustment_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "finance"."CommissionPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
