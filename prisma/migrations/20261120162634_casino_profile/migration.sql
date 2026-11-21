-- CreateTable
CREATE TABLE "finance"."GuestCreditLine" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "casinoId" TEXT NOT NULL,
    "frontMoney" DECIMAL(18,2),
    "creditLimit" DECIMAL(18,2),
    "currency" TEXT NOT NULL,
    "note" TEXT,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestCreditLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestProfile" (
    "guestId" TEXT NOT NULL,
    "nationality" TEXT,
    "gender" TEXT,
    "birthDate" DATE,
    "tcNoEnc" TEXT,
    "tcNoHash" TEXT,
    "passportNoEnc" TEXT,
    "passportNoHash" TEXT,
    "passportCountry" TEXT,
    "passportExpiry" DATE,
    "addressEnc" TEXT,
    "games" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tableMin" INTEGER,
    "tableMax" INTEGER,
    "limitCurrency" TEXT,
    "hostUserId" TEXT,
    "preferences" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestProfile_pkey" PRIMARY KEY ("guestId")
);

-- CreateTable
CREATE TABLE "GuestDocument" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "scanResult" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,

    CONSTRAINT "GuestDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."TripGuestTravel" (
    "tripGuestId" TEXT NOT NULL,
    "outFlight" TEXT,
    "outAt" TIMESTAMP(3),
    "outRoute" TEXT,
    "retFlight" TEXT,
    "retAt" TIMESTAMP(3),
    "retRoute" TEXT,
    "pnr" TEXT,
    "hotel" TEXT,
    "roomType" TEXT,
    "checkIn" DATE,
    "checkOut" DATE,
    "transfer" TEXT,
    "companion" TEXT,
    "note" TEXT,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripGuestTravel_pkey" PRIMARY KEY ("tripGuestId")
);

-- CreateIndex
CREATE INDEX "GuestCreditLine_casinoId_idx" ON "finance"."GuestCreditLine"("casinoId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestCreditLine_guestId_casinoId_key" ON "finance"."GuestCreditLine"("guestId", "casinoId");

-- CreateIndex
CREATE INDEX "GuestProfile_tcNoHash_idx" ON "GuestProfile"("tcNoHash");

-- CreateIndex
CREATE INDEX "GuestProfile_passportNoHash_idx" ON "GuestProfile"("passportNoHash");

-- CreateIndex
CREATE INDEX "GuestDocument_guestId_idx" ON "GuestDocument"("guestId");

-- AddForeignKey
ALTER TABLE "finance"."GuestCreditLine" ADD CONSTRAINT "GuestCreditLine_casinoId_fkey" FOREIGN KEY ("casinoId") REFERENCES "finance"."Casino"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestProfile" ADD CONSTRAINT "GuestProfile_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestDocument" ADD CONSTRAINT "GuestDocument_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."TripGuestTravel" ADD CONSTRAINT "TripGuestTravel_tripGuestId_fkey" FOREIGN KEY ("tripGuestId") REFERENCES "finance"."TripGuest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
