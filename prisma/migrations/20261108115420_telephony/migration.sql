-- AlterTable
ALTER TABLE "User" ADD COLUMN     "extension" TEXT;

-- CreateTable
CREATE TABLE "TelephonyEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "callId" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelephonyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelephonyIncident" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "callId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "TelephonyIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelephonyEvent_provider_eventId_key" ON "TelephonyEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "TelephonyIncident_at_idx" ON "TelephonyIncident"("at");
