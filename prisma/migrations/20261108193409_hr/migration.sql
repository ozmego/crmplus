-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "hr";

-- CreateTable
CREATE TABLE "hr"."Employee" (
    "id" TEXT NOT NULL,
    "sicilNo" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "title" TEXT,
    "teamId" TEXT,
    "managerId" TEXT,
    "employmentType" TEXT NOT NULL DEFAULT 'FULL',
    "weeklyHours" INTEGER NOT NULL DEFAULT 45,
    "hireDate" DATE NOT NULL,
    "exitDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "userId" TEXT,
    "phoneEnc" TEXT,
    "emailEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."ShiftTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "breakMin" INTEGER NOT NULL DEFAULT 60,
    "color" TEXT NOT NULL DEFAULT '#1FA29A',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ShiftTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."Roster" (
    "id" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "prevPublishedAt" TIMESTAMP(3),
    "overrideReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Roster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."RosterAssignment" (
    "id" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "templateId" TEXT,
    "startMin" INTEGER,
    "endMin" INTEGER,
    "breakMin" INTEGER,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RosterAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "city" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."FieldRoute" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "FieldRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."RouteStop" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "seq" INTEGER NOT NULL,
    "plannedMin" INTEGER,
    "locationId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "guestId" TEXT,
    "guestName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "resultNote" TEXT,

    CONSTRAINT "RouteStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."LeaveType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "needsDocument" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."LeaveRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "halfDay" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,
    "documentRef" TEXT,
    "requestedBy" TEXT NOT NULL,
    "preApprovedBy" TEXT,
    "approvedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."PublicHoliday" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "halfDay" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PublicHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."AttendanceDay" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "planStart" TIMESTAMP(3),
    "planEnd" TIMESTAMP(3),
    "firstIn" TIMESTAMP(3),
    "lastOut" TIMESTAMP(3),
    "workedMin" INTEGER NOT NULL DEFAULT 0,
    "breakMin" INTEGER NOT NULL DEFAULT 0,
    "lateMin" INTEGER NOT NULL DEFAULT 0,
    "earlyMin" INTEGER NOT NULL DEFAULT 0,
    "overtimeMin" INTEGER NOT NULL DEFAULT 0,
    "holidayWorkMin" INTEGER NOT NULL DEFAULT 0,
    "code" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'SYSTEM',
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "adjusted" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."AttendanceAdjustment" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hr"."TimesheetPeriod" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "preparedBy" TEXT,
    "preparedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "TimesheetPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_sicilNo_key" ON "hr"."Employee"("sicilNo");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "hr"."Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_teamId_idx" ON "hr"."Employee"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "ShiftTemplate_name_key" ON "hr"."ShiftTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Roster_weekStart_scope_key" ON "hr"."Roster"("weekStart", "scope");

-- CreateIndex
CREATE INDEX "RosterAssignment_rosterId_idx" ON "hr"."RosterAssignment"("rosterId");

-- CreateIndex
CREATE UNIQUE INDEX "RosterAssignment_employeeId_date_key" ON "hr"."RosterAssignment"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "hr"."Location"("name");

-- CreateIndex
CREATE UNIQUE INDEX "FieldRoute_employeeId_weekStart_key" ON "hr"."FieldRoute"("employeeId", "weekStart");

-- CreateIndex
CREATE INDEX "RouteStop_routeId_date_idx" ON "hr"."RouteStop"("routeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveType_code_key" ON "hr"."LeaveType"("code");

-- CreateIndex
CREATE INDEX "LeaveRequest_employeeId_startDate_idx" ON "hr"."LeaveRequest"("employeeId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "PublicHoliday_date_key" ON "hr"."PublicHoliday"("date");

-- CreateIndex
CREATE INDEX "AttendanceDay_date_idx" ON "hr"."AttendanceDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDay_employeeId_date_key" ON "hr"."AttendanceDay"("employeeId", "date");

-- CreateIndex
CREATE INDEX "AttendanceAdjustment_dayId_idx" ON "hr"."AttendanceAdjustment"("dayId");

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetPeriod_month_scope_key" ON "hr"."TimesheetPeriod"("month", "scope");

-- AddForeignKey
ALTER TABLE "hr"."Employee" ADD CONSTRAINT "Employee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "hr"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."RosterAssignment" ADD CONSTRAINT "RosterAssignment_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "hr"."Roster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."RosterAssignment" ADD CONSTRAINT "RosterAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hr"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."FieldRoute" ADD CONSTRAINT "FieldRoute_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hr"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."RouteStop" ADD CONSTRAINT "RouteStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "hr"."FieldRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."RouteStop" ADD CONSTRAINT "RouteStop_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "hr"."Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hr"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."LeaveRequest" ADD CONSTRAINT "LeaveRequest_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "hr"."LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."AttendanceDay" ADD CONSTRAINT "AttendanceDay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hr"."Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr"."AttendanceAdjustment" ADD CONSTRAINT "AttendanceAdjustment_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "hr"."AttendanceDay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
