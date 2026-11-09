-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'SMS',
    "category" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'tr',
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'SMS',
    "category" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "segment" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "estimate" JSONB,
    "stats" JSONB,
    "legalConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "preparedBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "guestId" TEXT,
    "phoneId" TEXT,
    "phoneHash" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'SMS',
    "direction" TEXT NOT NULL,
    "templateId" TEXT,
    "bodyEnc" TEXT NOT NULL,
    "segments" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentById" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptOutEvent" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "guestIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OptOutEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Message_campaignId_status_idx" ON "Message"("campaignId", "status");

-- CreateIndex
CREATE INDEX "Message_guestId_createdAt_idx" ON "Message"("guestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_provider_providerMessageId_key" ON "Message"("provider", "providerMessageId");
