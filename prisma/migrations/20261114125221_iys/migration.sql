-- CreateTable
CREATE TABLE "IysQueryLog" (
    "id" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IysQueryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IysOutbox" (
    "id" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "phoneEnc" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "IysOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IysQueryLog_phoneHash_type_at_idx" ON "IysQueryLog"("phoneHash", "type", "at");

-- CreateIndex
CREATE INDEX "IysOutbox_status_createdAt_idx" ON "IysOutbox"("status", "createdAt");
