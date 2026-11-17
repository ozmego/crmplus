-- CreateIndex
CREATE INDEX "CommissionAdjustment_calculationId_idx" ON "finance"."CommissionAdjustment"("calculationId");

-- CreateIndex
CREATE INDEX "CommissionAdjustment_periodId_idx" ON "finance"."CommissionAdjustment"("periodId");

-- CreateIndex
CREATE INDEX "CommissionCalculation_periodId_idx" ON "finance"."CommissionCalculation"("periodId");

-- CreateIndex
CREATE INDEX "Contract_casinoId_idx" ON "finance"."Contract"("casinoId");

-- CreateIndex
CREATE INDEX "GamingResult_tripGuestId_idx" ON "finance"."GamingResult"("tripGuestId");

-- CreateIndex
CREATE INDEX "Trip_casinoId_idx" ON "finance"."Trip"("casinoId");

-- CreateIndex
CREATE INDEX "AnalysisReview_analysisId_idx" ON "AnalysisReview"("analysisId");

-- CreateIndex
CREATE INDEX "Call_taskId_idx" ON "Call"("taskId");

-- CreateIndex
CREATE INDEX "Callback_guestId_idx" ON "Callback"("guestId");

-- CreateIndex
CREATE INDEX "GuestEmail_guestId_idx" ON "GuestEmail"("guestId");

-- CreateIndex
CREATE INDEX "GuestExternalId_guestId_idx" ON "GuestExternalId"("guestId");

-- CreateIndex
CREATE INDEX "GuestNote_guestId_idx" ON "GuestNote"("guestId");

-- CreateIndex
CREATE INDEX "MfaRecoveryCode_userId_idx" ON "MfaRecoveryCode"("userId");

-- CreateIndex
CREATE INDEX "QaReview_sampleId_idx" ON "QaReview"("sampleId");

-- CreateIndex
CREATE INDEX "Task_campaignId_idx" ON "Task"("campaignId");

-- CreateIndex
CREATE INDEX "TranscriptEdit_transcriptId_idx" ON "TranscriptEdit"("transcriptId");

-- CreateIndex
CREATE INDEX "User_teamId_idx" ON "User"("teamId");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");
