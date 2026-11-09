-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceUrlEnc" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_FETCH',
    "discardReason" TEXT,
    "storageKey" TEXT,
    "channels" INTEGER NOT NULL DEFAULT 1,
    "durationSec" INTEGER,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "retentionUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcript" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "language" TEXT,
    "model" TEXT,
    "modelVersion" TEXT,
    "confidence" DOUBLE PRECISION,
    "rawEnc" TEXT,
    "rawExpiresAt" TIMESTAMP(3),
    "segments" JSONB,
    "redactedKinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptEdit" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "segmentIndex" INTEGER NOT NULL,
    "before" TEXT NOT NULL,
    "after" TEXT NOT NULL,
    "editorId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptEdit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallAnalysis" (
    "id" TEXT NOT NULL,
    "transcriptId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "topics" TEXT[],
    "actions" JSONB NOT NULL,
    "processFlags" JSONB NOT NULL,
    "dispositionMismatch" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisReview" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "changes" JSONB,
    "comment" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordingAccessGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordingAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Recording_callId_key" ON "Recording"("callId");

-- CreateIndex
CREATE INDEX "Recording_status_idx" ON "Recording"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_recordingId_key" ON "Transcript"("recordingId");

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_callId_key" ON "Transcript"("callId");

-- CreateIndex
CREATE INDEX "Transcript_status_idx" ON "Transcript"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CallAnalysis_transcriptId_key" ON "CallAnalysis"("transcriptId");

-- CreateIndex
CREATE UNIQUE INDEX "CallAnalysis_callId_key" ON "CallAnalysis"("callId");

-- CreateIndex
CREATE INDEX "CallAnalysis_reviewStatus_idx" ON "CallAnalysis"("reviewStatus");

-- CreateIndex
CREATE INDEX "RecordingAccessGrant_userId_callId_idx" ON "RecordingAccessGrant"("userId", "callId");

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptEdit" ADD CONSTRAINT "TranscriptEdit_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallAnalysis" ADD CONSTRAINT "CallAnalysis_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisReview" ADD CONSTRAINT "AnalysisReview_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "CallAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
