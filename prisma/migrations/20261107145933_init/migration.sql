-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "finance";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'LOCKED', 'DISABLED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('P1', 'P2', 'P3', 'P4');

-- CreateEnum
CREATE TYPE "PhoneFormatStatus" AS ENUM ('VALID', 'INVALID', 'COUNTRY_MISMATCH');

-- CreateEnum
CREATE TYPE "PhoneReachability" AS ENUM ('UNVERIFIED', 'REACHED', 'UNREACHED', 'UNREACHABLE');

-- CreateEnum
CREATE TYPE "PhoneOwnership" AS ENUM ('CONFIRMED', 'UNCONFIRMED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "ImportPurpose" AS ENUM ('NEW_LIST', 'UPDATE', 'COMPARE');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'SCANNED', 'REJECTED', 'MAPPED', 'PREVIEWED', 'APPLYING', 'APPLIED', 'ROLLED_BACK', 'FAILED');

-- CreateEnum
CREATE TYPE "ConsentChannel" AS ENUM ('CALL', 'SMS', 'WHATSAPP', 'EMAIL', 'RECORDING');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'DENIED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED', 'BLOCKED', 'EXHAUSTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "mfaSecretEnc" TEXT,
    "mfaEnabledAt" TIMESTAMP(3),
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "languages" TEXT[] DEFAULT ARRAY['tr']::TEXT[],
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disabledAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "leaderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "system" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'own',

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permission")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mfaVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "revokedAt" TIMESTAMP(3),
    "elevatedUntil" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MfaRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "MfaRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "reason" TEXT,
    "diff" JSONB,
    "ip" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessLog" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "reason" TEXT,
    "meta" JSONB,
    "ip" TEXT,

    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessAlert" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rule" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "actorId" TEXT,
    "detail" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolution" TEXT,

    CONSTRAINT "AccessAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "crmNo" SERIAL NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'tr',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Istanbul',
    "country" TEXT,
    "city" TEXT,
    "birthYear" INTEGER,
    "vipLevel" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ownerId" TEXT,
    "fieldSources" JSONB,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestPhone" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "e164Enc" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "masked" TEXT NOT NULL,
    "country" TEXT,
    "lineType" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "formatStatus" "PhoneFormatStatus" NOT NULL DEFAULT 'VALID',
    "reachability" "PhoneReachability" NOT NULL DEFAULT 'UNVERIFIED',
    "ownership" "PhoneOwnership" NOT NULL DEFAULT 'UNCONFIRMED',
    "lastReachedAt" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "consecutiveFails" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestPhone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhoneCheck" (
    "id" TEXT NOT NULL,
    "phoneId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "PhoneCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestEmail" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "emailEnc" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "masked" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GuestEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestExternalId" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "GuestExternalId_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestNote" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "authorId" TEXT,
    "bodyEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "direction" TEXT,
    "refId" TEXT,
    "summary" TEXT,
    "actorId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldHistory" (
    "id" BIGSERIAL NOT NULL,
    "guestId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "sourceId" TEXT,
    "importBatchId" TEXT,
    "actorId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MergeRecord" (
    "id" TEXT NOT NULL,
    "survivorId" TEXT NOT NULL,
    "mergedId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "MergeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "purpose" "ImportPurpose" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "sourceLabel" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "storageKey" TEXT,
    "fileExpiresAt" TIMESTAMP(3),
    "scanResult" TEXT,
    "sheetName" TEXT,
    "headers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mapping" JSONB,
    "matchKey" TEXT,
    "defaultCountry" TEXT NOT NULL DEFAULT 'TR',
    "summary" JSONB,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "parentId" TEXT,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" BIGSERIAL NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNo" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "normalized" JSONB,
    "result" TEXT,
    "guestId" TEXT,
    "errors" JSONB,
    "decisions" JSONB,
    "applied" JSONB,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MappingTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partner" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "mapping" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MappingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewItem" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "guestId" TEXT,
    "candidates" JSONB NOT NULL,
    "payload" JSONB,
    "sourceRef" TEXT,
    "decision" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComparisonJob" (
    "id" TEXT NOT NULL,
    "leftRef" TEXT NOT NULL,
    "rightRef" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "summary" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComparisonJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComparisonResult" (
    "id" BIGSERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "guestId" TEXT,
    "rowNo" INTEGER,
    "diff" JSONB,

    CONSTRAINT "ComparisonResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "channel" "ConsentChannel" NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "scope" TEXT NOT NULL DEFAULT 'MARKETING',
    "source" TEXT,
    "sourceSystem" TEXT,
    "proofRef" TEXT,
    "grantedAt" TIMESTAMP(3),
    "deniedAt" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "iysRef" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentHistory" (
    "id" BIGSERIAL NOT NULL,
    "guestId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "oldStatus" TEXT,
    "newStatus" TEXT NOT NULL,
    "source" TEXT,
    "actorId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactBlock" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "allChannels" BOOLEAN NOT NULL DEFAULT true,
    "channel" TEXT,
    "reason" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT,
    "proof" TEXT,
    "removedAt" TIMESTAMP(3),
    "removedBy" TEXT,

    CONSTRAINT "ContactBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'CALL',
    "reason" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "campaignId" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" INTEGER NOT NULL DEFAULT 2,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastDisposition" TEXT,
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disposition" (
    "code" TEXT NOT NULL,
    "labelTr" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "countsAsReached" BOOLEAN NOT NULL,
    "noteRequired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Disposition_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "phoneId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "taskId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "externalId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "ringSec" INTEGER,
    "talkSec" INTEGER,
    "wrapSec" INTEGER,
    "disposition" TEXT,
    "dispositionSub" TEXT,
    "noteEnc" TEXT,
    "autoClosed" BOOLEAN NOT NULL DEFAULT false,
    "recordingNotice" BOOLEAN,
    "recordingPreference" TEXT,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Callback" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sourceCallId" TEXT,
    "doneCallId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Callback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentStatusLog" (
    "id" BIGSERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "finance"."Casino" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'TRY',

    CONSTRAINT "Casino_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."Contract" (
    "id" TEXT NOT NULL,
    "casinoId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."ContractVersion" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "combine" TEXT NOT NULL DEFAULT 'SUM',
    "rules" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."CommissionPeriod" (
    "id" TEXT NOT NULL,
    "casinoId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,

    CONSTRAINT "CommissionPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."CommissionCalculation" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "preparedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionCalculation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "LoginAttempt_email_createdAt_idx" ON "LoginAttempt"("email", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_at_idx" ON "AuditLog"("actorId", "at");

-- CreateIndex
CREATE INDEX "AccessLog_actorId_at_idx" ON "AccessLog"("actorId", "at");

-- CreateIndex
CREATE INDEX "AccessLog_action_at_idx" ON "AccessLog"("action", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Guest_crmNo_key" ON "Guest"("crmNo");

-- CreateIndex
CREATE INDEX "Guest_lastName_firstName_idx" ON "Guest"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "Guest_ownerId_idx" ON "Guest"("ownerId");

-- CreateIndex
CREATE INDEX "GuestPhone_phoneHash_idx" ON "GuestPhone"("phoneHash");

-- CreateIndex
CREATE INDEX "GuestPhone_guestId_idx" ON "GuestPhone"("guestId");

-- CreateIndex
CREATE INDEX "PhoneCheck_phoneId_at_idx" ON "PhoneCheck"("phoneId", "at");

-- CreateIndex
CREATE INDEX "GuestEmail_emailHash_idx" ON "GuestEmail"("emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "GuestExternalId_source_value_key" ON "GuestExternalId"("source", "value");

-- CreateIndex
CREATE INDEX "Interaction_guestId_at_idx" ON "Interaction"("guestId", "at");

-- CreateIndex
CREATE INDEX "FieldHistory_guestId_at_idx" ON "FieldHistory"("guestId", "at");

-- CreateIndex
CREATE INDEX "FieldHistory_importBatchId_idx" ON "FieldHistory"("importBatchId");

-- CreateIndex
CREATE INDEX "ImportRow_batchId_rowNo_idx" ON "ImportRow"("batchId", "rowNo");

-- CreateIndex
CREATE INDEX "ImportRow_batchId_result_idx" ON "ImportRow"("batchId", "result");

-- CreateIndex
CREATE UNIQUE INDEX "MappingTemplate_name_version_key" ON "MappingTemplate"("name", "version");

-- CreateIndex
CREATE INDEX "ReviewItem_status_kind_idx" ON "ReviewItem"("status", "kind");

-- CreateIndex
CREATE INDEX "ComparisonResult_jobId_status_idx" ON "ComparisonResult"("jobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentRecord_guestId_channel_key" ON "ConsentRecord"("guestId", "channel");

-- CreateIndex
CREATE INDEX "ConsentHistory_guestId_at_idx" ON "ConsentHistory"("guestId", "at");

-- CreateIndex
CREATE INDEX "ContactBlock_guestId_idx" ON "ContactBlock"("guestId");

-- CreateIndex
CREATE INDEX "Task_assigneeId_status_idx" ON "Task"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Task_guestId_idx" ON "Task"("guestId");

-- CreateIndex
CREATE INDEX "Call_agentId_startedAt_idx" ON "Call"("agentId", "startedAt");

-- CreateIndex
CREATE INDEX "Call_guestId_startedAt_idx" ON "Call"("guestId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Call_provider_externalId_key" ON "Call"("provider", "externalId");

-- CreateIndex
CREATE INDEX "Callback_assigneeId_scheduledAt_idx" ON "Callback"("assigneeId", "scheduledAt");

-- CreateIndex
CREATE INDEX "AgentStatusLog_userId_at_idx" ON "AgentStatusLog"("userId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Casino_name_key" ON "finance"."Casino"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ContractVersion_contractId_version_key" ON "finance"."ContractVersion"("contractId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionPeriod_casinoId_period_key" ON "finance"."CommissionPeriod"("casinoId", "period");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaRecoveryCode" ADD CONSTRAINT "MfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestPhone" ADD CONSTRAINT "GuestPhone_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneCheck" ADD CONSTRAINT "PhoneCheck_phoneId_fkey" FOREIGN KEY ("phoneId") REFERENCES "GuestPhone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestEmail" ADD CONSTRAINT "GuestEmail_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestExternalId" ADD CONSTRAINT "GuestExternalId_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestNote" ADD CONSTRAINT "GuestNote_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldHistory" ADD CONSTRAINT "FieldHistory_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonResult" ADD CONSTRAINT "ComparisonResult_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ComparisonJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactBlock" ADD CONSTRAINT "ContactBlock_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Callback" ADD CONSTRAINT "Callback_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Callback" ADD CONSTRAINT "Callback_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStatusLog" ADD CONSTRAINT "AgentStatusLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."Contract" ADD CONSTRAINT "Contract_casinoId_fkey" FOREIGN KEY ("casinoId") REFERENCES "finance"."Casino"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."ContractVersion" ADD CONSTRAINT "ContractVersion_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "finance"."Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."CommissionCalculation" ADD CONSTRAINT "CommissionCalculation_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "finance"."CommissionPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
