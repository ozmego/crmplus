-- CreateTable
CREATE TABLE "VocabularyTerm" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VocabularyTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaCriteriaSet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "criteria" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaCriteriaSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaSample" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "teamId" TEXT,
    "reason" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "agentComment" TEXT,
    "agentRespondedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "closedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaReview" (
    "id" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "criteriaSetId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "coachingNote" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VocabularyTerm_term_key" ON "VocabularyTerm"("term");

-- CreateIndex
CREATE UNIQUE INDEX "QaCriteriaSet_name_version_key" ON "QaCriteriaSet"("name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "QaSample_callId_key" ON "QaSample"("callId");

-- CreateIndex
CREATE INDEX "QaSample_teamId_status_idx" ON "QaSample"("teamId", "status");

-- CreateIndex
CREATE INDEX "QaSample_agentId_status_idx" ON "QaSample"("agentId", "status");

-- AddForeignKey
ALTER TABLE "QaReview" ADD CONSTRAINT "QaReview_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "QaSample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaReview" ADD CONSTRAINT "QaReview_criteriaSetId_fkey" FOREIGN KEY ("criteriaSetId") REFERENCES "QaCriteriaSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
