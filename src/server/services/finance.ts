import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import type { Principal } from "@/server/auth/rbac";
import { audit, logAccess } from "@/server/audit";
import { canLockPeriod, checkTransition, contractVersionSchema, nextPeriod, periodOf, type CalcAction, type CalcStatus, type ContractVersionInput } from "@/lib/finance";
import { fromKurus, shadowDiff, toKurus } from "@/lib/commission";
import { engineForPeriod, engineSettings } from "@/server/services/finance-engine";

/**
 * Finans modülü — docs/06 (Aşama 1: kayıt + onay; otomatik hesap Aşama 3).
 * Misafir verisinden yalnız ad ve CRM no okunur. Her görüntüleme "finance:" önekiyle erişim kaydına yazılır.
 */

export class FinanceError extends Error {
  constructor(public code: string, detail?: string) {
    super(detail ?? code);
  }
}

const D = (v: string | number) => new Prisma.Decimal(v);

export async function financeView(user: Principal, resource: string, resourceId?: string) {
  await logAccess({ actorId: user.id, action: "view", resource: `finance:${resource}`, resourceId });
}

// ───────────── Casino ve sözleşme ─────────────

export async function createCasino(user: Principal, input: { name: string; country?: string; currency: string }) {
  if (await db.casino.findUnique({ where: { name: input.name.trim() } })) throw new FinanceError("CASINO_EXISTS");
  const c = await db.casino.create({ data: { name: input.name.trim(), country: input.country?.toUpperCase() || null, currency: input.currency } });
  await audit({ actorId: user.id, action: "finance.casino.create", entity: "Casino", entityId: c.id, diff: input });
  return c;
}

export async function addContractVersion(user: Principal, input: { casinoId: string; contractId?: string; contractName?: string; version: ContractVersionInput }) {
  const v = contractVersionSchema.parse(input.version);
  return db.$transaction(async (tx) => {
    let contractId = input.contractId;
    if (!contractId) {
      if (!input.contractName?.trim()) throw new FinanceError("CONTRACT_NAME_REQUIRED");
      contractId = (await tx.contract.create({ data: { casinoId: input.casinoId, name: input.contractName.trim() } })).id;
    }
    const last = await tx.contractVersion.findFirst({ where: { contractId }, orderBy: { version: "desc" } });
    // Yeni sürüm başlarken önceki açık uçlu sürüm bir gün öncesinde kapanır (geçmiş hesaplar kendi sürümünü korur)
    if (last && !last.validTo) {
      const end = new Date(`${v.validFrom}T00:00:00+03:00`);
      end.setDate(end.getDate() - 1);
      if (end < last.validFrom) throw new FinanceError("OVERLAP", "Yeni sürüm önceki sürümden önce başlayamaz");
      await tx.contractVersion.update({ where: { id: last.id }, data: { validTo: end } });
    }
    const cv = await tx.contractVersion.create({
      data: {
        contractId,
        version: (last?.version ?? 0) + 1,
        validFrom: new Date(`${v.validFrom}T00:00:00+03:00`),
        validTo: v.validTo ? new Date(`${v.validTo}T23:59:59+03:00`) : null,
        combine: v.combine,
        rules: v.rules as unknown as Prisma.InputJsonValue,
        note: v.note,
        createdBy: user.id,
      },
    });
    await audit({ actorId: user.id, action: "finance.contract.version", entity: "ContractVersion", entityId: cv.id, diff: { contractId, version: cv.version } }, tx);
    return cv;
  });
}

// ───────────── Trip ve oyun sonuçları ─────────────

export async function createTrip(user: Principal, input: { casinoId: string; name: string; startDate: string; endDate: string }) {
  if (input.endDate < input.startDate) throw new FinanceError("BAD_DATES");
  const t = await db.trip.create({
    data: {
      casinoId: input.casinoId, name: input.name.trim(), createdBy: user.id,
      startDate: new Date(`${input.startDate}T00:00:00+03:00`), endDate: new Date(`${input.endDate}T23:59:59+03:00`),
    },
  });
  await audit({ actorId: user.id, action: "finance.trip.create", entity: "Trip", entityId: t.id, diff: input });
  return t;
}

export async function addTripGuest(user: Principal, tripId: string, crmNo: number) {
  // Finans yalnız ad ve CRM no görür (docs/01 dipnot 2)
  const g = await db.guest.findUnique({ where: { crmNo }, select: { id: true, crmNo: true, firstName: true, lastName: true, anonymizedAt: true, country: true } });
  if (!g || g.anonymizedAt) throw new FinanceError("GUEST_NOT_FOUND");
  const tg = await db.tripGuest.create({ data: { tripId, guestId: g.id, crmNo: g.crmNo, guestName: `${g.firstName} ${g.lastName}`, country: g.country } }).catch((e) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new FinanceError("ALREADY_IN_TRIP");
    throw e;
  });
  await audit({ actorId: user.id, action: "finance.trip.guest", entity: "Trip", entityId: tripId, diff: { crmNo } });
  return tg;
}

async function periodFor(tx: Prisma.TransactionClient, casinoId: string, period: string) {
  return tx.commissionPeriod.upsert({ where: { casinoId_period: { casinoId, period } }, update: {}, create: { casinoId, period } });
}

export async function addResult(
  user: Principal,
  input: { tripGuestId: string; playedOn: string; buyIn?: string; cashOut?: string; rolling?: string; netLoss: string; source: "MANUAL" | "STATEMENT"; sourceRef?: string },
) {
  return db.$transaction(async (tx) => {
    const tg = await tx.tripGuest.findUniqueOrThrow({ where: { id: input.tripGuestId }, include: { trip: { include: { casino: true } } } });
    const playedOn = new Date(`${input.playedOn}T12:00:00+03:00`);
    const p = await periodFor(tx, tg.trip.casinoId, periodOf(playedOn));
    if (p.status === "LOCKED") throw new FinanceError("PERIOD_LOCKED", "Kilitli döneme sonuç girilemez; düzeltme kaydı kullanın.");
    const r = await tx.gamingResult.create({
      data: {
        tripGuestId: tg.id, periodId: p.id, playedOn, currency: tg.trip.casino.currency, source: input.source, sourceRef: input.sourceRef, enteredBy: user.id,
        buyIn: input.buyIn ? D(input.buyIn) : null, cashOut: input.cashOut ? D(input.cashOut) : null, rolling: input.rolling ? D(input.rolling) : null, netLoss: D(input.netLoss),
      },
    });
    await audit({ actorId: user.id, action: "finance.result.add", entity: "GamingResult", entityId: r.id, diff: { periodId: p.id, netLoss: input.netLoss } }, tx);
    return r;
  });
}

// ───────────── Dönem ve hesaplama ─────────────

export async function periodTotals(periodId: string) {
  const agg = await db.gamingResult.aggregate({ where: { periodId }, _sum: { netLoss: true, rolling: true }, _count: true });
  const guests = await db.gamingResult.findMany({ where: { periodId }, distinct: ["tripGuestId"], select: { tripGuest: { select: { guestId: true } } } });
  const trips = await db.gamingResult.findMany({ where: { periodId }, distinct: ["tripGuestId"], select: { tripGuest: { select: { tripId: true } } } });
  return {
    netLoss: agg._sum.netLoss ?? D(0),
    rolling: agg._sum.rolling ?? D(0),
    results: agg._count,
    guests: new Set(guests.map((g) => g.tripGuest.guestId)).size,
    trips: new Set(trips.map((t) => t.tripGuest.tripId)).size,
  };
}

/**
 * Hesaplama taslağı (Aşama 3): motor her zaman çalışır ve sonucu anlık görüntüye yazılır.
 * Gölge modda tutar elle girilir (motor yanında gösterilir); birincil modda tutar boşsa motor sonucu kullanılır.
 */
export async function createCalculation(user: Principal, input: { periodId: string; amount?: string; note: string }) {
  const p = await db.commissionPeriod.findUniqueOrThrow({ where: { id: input.periodId }, include: { casino: true } });
  if (p.status === "LOCKED") throw new FinanceError("PERIOD_LOCKED");
  const [y, m] = p.period.split("-").map(Number);
  const periodStart = new Date(`${p.period}-01T00:00:00+03:00`);
  const periodEnd = new Date(Date.UTC(y, m, 1) - 3 * 3_600_000 - 1);
  const versions = await db.contractVersion.findMany({
    where: { contract: { casinoId: p.casinoId }, validFrom: { lte: periodEnd }, OR: [{ validTo: null }, { validTo: { gte: periodStart } }] },
    include: { contract: { select: { name: true } } },
    orderBy: { version: "desc" },
  });
  if (!versions.length) throw new FinanceError("NO_CONTRACT", "Bu dönemde geçerli sözleşme sürümü yok.");
  const results = await db.gamingResult.findMany({
    where: { periodId: p.id },
    select: { id: true, netLoss: true, rolling: true, playedOn: true, source: true, sourceRef: true, enteredAt: true, tripGuest: { select: { crmNo: true, guestName: true, tripId: true } } },
  });
  const totals = await periodTotals(p.id);
  const engine = await engineForPeriod(p.id);
  const { mode } = await engineSettings();
  const manual = input.amount?.trim();
  if (!manual && mode === "SHADOW") throw new FinanceError("AMOUNT_REQUIRED_SHADOW");
  const engineAmount = fromKurus(engine.total);
  const amount = manual || engineAmount;
  const prev = await db.commissionCalculation.count({ where: { periodId: p.id } });
  const calc = await db.commissionCalculation.create({
    data: {
      periodId: p.id,
      version: prev + 1,
      amount: D(amount),
      engineAmount: D(engineAmount),
      method: manual ? "MANUAL" : "ENGINE",
      currency: p.casino.currency,
      note: input.note,
      preparedBy: user.id,
      snapshot: {
        method: manual ? "MANUAL" : "ENGINE",
        engineMode: mode,
        engine: { ...engine, total: engine.total } as unknown,
        shadow: shadowDiff(toKurus(amount), engine.total),
        contracts: versions.map((v) => ({ contract: v.contract.name, versionId: v.id, version: v.version, combine: v.combine, rules: v.rules, validFrom: v.validFrom, validTo: v.validTo })),
        totals: { netLoss: totals.netLoss.toString(), rolling: totals.rolling.toString(), guests: totals.guests, trips: totals.trips, results: totals.results },
        inputs: results.map((r) => ({ id: r.id, crmNo: r.tripGuest.crmNo, trip: r.tripGuest.tripId, playedOn: r.playedOn, netLoss: r.netLoss.toString(), rolling: r.rolling?.toString() ?? null, source: r.source, sourceRef: r.sourceRef, enteredAt: r.enteredAt })),
        capturedAt: new Date().toISOString(),
      } as unknown as Prisma.InputJsonValue,
    },
  });
  await audit({ actorId: user.id, action: "finance.calc.create", entity: "CommissionCalculation", entityId: calc.id, diff: { periodId: p.id, amount, engineAmount, method: manual ? "MANUAL" : "ENGINE", version: calc.version } });
  return calc;
}

export async function transitionCalculation(user: Principal, calcId: string, action: CalcAction, extra: { reason?: string; statementRef?: string }) {
  const calc = await db.commissionCalculation.findUniqueOrThrow({ where: { id: calcId }, include: { period: true } });
  const r = checkTransition({ status: calc.status as CalcStatus, preparedBy: calc.preparedBy }, action, {
    actorId: user.id, periodLocked: calc.period.status === "LOCKED", reason: extra.reason, statementRef: extra.statementRef,
  });
  if (!r.ok) throw new FinanceError(r.error);
  // Gölge mod kontrolü (yetki ve iki kişili onaydan sonra): elle girilen tutar motordan farklıysa onay gerekçe ister
  if (action === "APPROVE" && calc.engineAmount && !calc.amount.equals(calc.engineAmount) && (extra.reason ?? "").trim().length < 5) throw new FinanceError("DIFF_REASON_REQUIRED");
  const now = new Date();
  await db.commissionCalculation.update({
    where: { id: calc.id },
    data: {
      status: r.to,
      ...(action === "SUBMIT" ? { submittedAt: now, rejectReason: null } : {}),
      ...(action === "APPROVE" ? { approvedBy: user.id, approvedAt: now, ...(extra.reason ? { note: `${calc.note ?? ""}
[Onay notu] ${extra.reason}`.trim() } : {}) } : {}),
      ...(action === "REJECT" ? { rejectReason: extra.reason } : {}),
      ...(action === "RECONCILE" ? { statementRef: extra.statementRef, reconciledBy: user.id, reconciledAt: now } : {}),
      ...(action === "CANCEL" ? { cancelReason: extra.reason } : {}),
    },
  });
  await audit({ actorId: user.id, action: `finance.calc.${action.toLowerCase()}`, entity: "CommissionCalculation", entityId: calc.id, reason: extra.reason ?? extra.statementRef, diff: { from: calc.status, to: r.to } });
}

export async function lockPeriod(user: Principal, periodId: string) {
  const p = await db.commissionPeriod.findUniqueOrThrow({ where: { id: periodId }, include: { calculations: { select: { status: true } } } });
  if (p.status === "LOCKED") throw new FinanceError("ALREADY_LOCKED");
  const ok = canLockPeriod(p.calculations.map((c) => c.status as CalcStatus));
  if (!ok.ok) throw new FinanceError(ok.error);
  await db.commissionPeriod.update({ where: { id: p.id }, data: { status: "LOCKED", lockedAt: new Date(), lockedBy: user.id } });
  await audit({ actorId: user.id, action: "finance.period.lock", entity: "CommissionPeriod", entityId: p.id, diff: { period: p.period } });
}

/** Kilitli döneme ait düzeltme: sonraki ilk açık dönemde yeni kayıt (docs/06 §6). */
export async function createAdjustment(user: Principal, input: { calculationId: string; amount: string; reason: string }) {
  const calc = await db.commissionCalculation.findUniqueOrThrow({ where: { id: input.calculationId }, include: { period: true } });
  if (calc.period.status !== "LOCKED") throw new FinanceError("PERIOD_NOT_LOCKED", "Açık dönemde düzeltme yerine yeni hesaplama sürümü kullanılır.");
  if (!["APPROVED", "RECONCILED"].includes(calc.status)) throw new FinanceError("BAD_STATE");
  if (input.reason.trim().length < 5) throw new FinanceError("REASON_REQUIRED");
  return db.$transaction(async (tx) => {
    let target = nextPeriod(calc.period.period);
    let p = await periodFor(tx, calc.period.casinoId, target);
    while (p.status === "LOCKED") {
      target = nextPeriod(target);
      p = await periodFor(tx, calc.period.casinoId, target);
    }
    const adj = await tx.commissionAdjustment.create({
      data: { calculationId: calc.id, periodId: p.id, amount: D(input.amount), currency: calc.currency, reason: input.reason.trim(), preparedBy: user.id },
    });
    await audit({ actorId: user.id, action: "finance.adjust.create", entity: "CommissionAdjustment", entityId: adj.id, reason: input.reason, diff: { calc: calc.id, targetPeriod: target, amount: input.amount } }, tx);
    return adj;
  });
}

export async function approveAdjustment(user: Principal, adjId: string) {
  const adj = await db.commissionAdjustment.findUniqueOrThrow({ where: { id: adjId }, include: { period: true } });
  if (adj.status !== "DRAFT") throw new FinanceError("BAD_STATE");
  if (adj.preparedBy === user.id) throw new FinanceError("SAME_PERSON");
  if (adj.period.status === "LOCKED") throw new FinanceError("PERIOD_LOCKED");
  await db.commissionAdjustment.update({ where: { id: adj.id }, data: { status: "APPROVED", approvedBy: user.id, approvedAt: new Date() } });
  await audit({ actorId: user.id, action: "finance.adjust.approve", entity: "CommissionAdjustment", entityId: adj.id });
}
