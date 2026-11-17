-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "waTemplateId" TEXT;

-- CreateTable
CREATE TABLE "WaTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'tr',
    "category" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "optOutButton" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "metaStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "internalApprovedBy" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusAt" TIMESTAMP(3),

    CONSTRAINT "WaTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "phoneHash" TEXT NOT NULL,
    "phoneEnc" TEXT NOT NULL,
    "guestId" TEXT,
    "assigneeId" TEXT,
    "teamId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "unread" INTEGER NOT NULL DEFAULT 0,
    "optOutSuspect" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaTemplate_name_language_version_key" ON "WaTemplate"("name", "language", "version");

-- CreateIndex
CREATE INDEX "Conversation_status_assigneeId_idx" ON "Conversation"("status", "assigneeId");

-- CreateIndex
CREATE INDEX "Conversation_phoneHash_idx" ON "Conversation"("phoneHash");
