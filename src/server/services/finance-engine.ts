import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import type { Principal } from "@/server/auth/rbac";
import { getSetting, setSetting } from "@/server/services/settings";
import { putEncrypted } from "@/server/storage";
import { scanBuffer } from "@/server/scan";
import { parseFile, MAX_FILE_BYTES } from "@/server/import/parse";
import { computeCommission, fromKurus, toKurus, type EngineOutput, type EngineResult, type EngineRule } from "@/lib/commission";
import { mapStatementHeaders, normalizeStatementRows, reconcile, type GuestTotals } from "@/lib/statement";
import { financeFindings, opsFindings, type CallDayRow } from "@/lib/finance-anomaly";
import { nextPeriod } from "@/lib/finance";
import { FinanceError } from "@/server/services/finance";

/**
 * Aşama 3 — komisyon motoru, casino ekstresi, mutabakat ve anomali raporu (docs/06).
 * Motor modu:
 *   SHADOW  (vars.) — tutar elle girilir, motor aynı anda hesaplanır, fark gösterilir ve onayda gerekçe ister
 *   PRIMARY          — tutar boş bırakılırsa motor sonucu kullanılır; elle tutar girilirse fark yine gerekçe ister
 */
export interface EngineSettings {
  mode: "SHADOW" | "PRIMARY";
}
export const engineSettings = () => getSetting<EngineSettings>("finance.engine", { mode: "SHADOW" });
export async function setEngineMode(user: Principal, mode: "SHADOW" | "PRIMARY", reason: string) {
  if (reason.trim().length < 5) throw new FinanceError("REASON_REQUIRED");
  await setSetting(user.id, "finance.engine", { mode }, reason);
}

function periodRange(period: string) {
  const [y, m] = period.split("-").map(Number);
  return { start: new Date(`${period}-01T00:00:00+03:00`), end: new Date(Date.UTC(y, m, 1) - 3 * 3_600_000 - 1) };
}
function prevPeriodOf(p: string) {
  const [y, m] = p.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Dönem motoru: sonuçlar oynanma tarihine göre sözleşme sürümlerine dağıtılır; devreden net kazanç önceki onaylı hesaptan okunur. */
export async function engineForPeriod(periodId: string): Promise<EngineOutput & { contracts: { contract: string; versionId: string; version: number }[] }> {
  const p = await db.commissionPeriod.findUniqueOrThrow({ where: { id: periodId }, include: { casino: true } });
  const { start, end } = periodRange(p.period);
  const versions = await db.contractVersion.findMany({
    where: { contract: { casinoId: p.casinoId }, validFrom: { lte: end }, OR: [{ validTo: null }, { validTo: { gte: start } }] },
    include: { contract: { select: { id: true, name: true } } },
    orderBy: [{ contractId: "asc" }, { version: "desc" }],
  });
  const results = await db.gamingResult.findMany({ where: { periodId }, include: { tripGuest: { select: { crmNo: true, tripId: true, country: true } } } });
  const toEngine = (r: (typeof results)[number]): EngineResult => ({
    id: r.id, guestKey: String(r.tripGuest.crmNo), tripId: r.tripGuest.tripId, country: r.tripGuest.country,
    netLoss: toKurus(r.netLoss.toString()), rolling: r.rolling ? toKurus(r.rolling.toString()) : 0,
  });

  // Önceki dönemin onaylı/mutabık son hesabındaki devir
  const prev = await db.commissionPeriod.findUnique({ where: { casinoId_period: { casinoId: p.casinoId, period: prevPeriodOf(p.period) } } });
  const prevCalc = prev ? await db.commissionCalculation.findFirst({ where: { periodId: prev.id, status: { in: ["APPROVED", "RECONCILED"] } }, orderBy: { version: "desc" } }) : null;
  const carryIn = ((prevCalc?.snapshot as { engine?: { carryOut?: Record<string, Record<string, number>> } } | null)?.engine?.carryOut) ?? {};

  const parts: { version: { versionId: string; label: string; combine: "SUM" | "MAX" | "PRIORITY"; rules: EngineRule[] }; results: EngineResult[] }[] = [];
  const assigned = new Set<string>();
  const byContract = new Map<string, typeof versions>();
  for (const v of versions) byContract.set(v.contractId, [...(byContract.get(v.contractId) ?? []), v]);
  for (const [, vs] of byContract) {
    const bucket = new Map<string, EngineResult[]>();
    for (const r of results) {
      const v = vs.find((x) => x.validFrom <= r.playedOn && (!x.validTo || r.playedOn <= x.validTo));
      if (!v) continue;
      assigned.add(r.id);
      bucket.set(v.id, [...(bucket.get(v.id) ?? []), toEngine(r)]);
    }
    for (const v of vs) {
      const rs = bucket.get(v.id);
      if (!rs?.length && !Object.keys(carryIn).some((k) => k.startsWith(`${v.contractId}:`))) continue;
      // Devir anahtarı sözleşme bazındadır (yeni sürüm açılınca devir kaybolmaz)
      parts.push({ version: { versionId: v.contractId, label: `${v.contract.name} · sürüm ${v.version}`, combine: v.combine as "SUM", rules: v.rules as unknown as EngineRule[] }, results: rs ?? [] });
    }
  }
  const out = computeCommission({ currency: p.casino.currency, parts, carryIn, unassigned: results.filter((r) => !assigned.has(r.id)).length });
  if (!versions.length) out.warnings.push("Bu dönemde geçerli sözleşme sürümü yok.");
  return { ...out, contracts: versions.map((v) => ({ contract: v.contract.name, versionId: v.id, version: v.version })) };
}

// ───────────── Casino ekstresi ─────────────

export async function importStatement(user: Principal, a: { casinoId: string; period: string; fileName: string; data: Buffer; invertSign: boolean }) {
  if (!/^\d{4}-\d{2}$/.test(a.period)) throw new FinanceError("BAD_PERIOD");
  if (a.data.length > MAX_FILE_BYTES) throw new FinanceError("FILE_TOO_LARGE");
  const scan = await scanBuffer(a.data);
  if (scan.status === "INFECTED") throw new FinanceError("INFECTED");
  // Tarayıcı yanıt vermezse dosya taranmadan kabul edilmez (geliştirmede SKIPPED olabilir)
  if (scan.status === "ERROR") throw new FinanceError("SCAN_FAILED");
  const casino = await db.casino.findUniqueOrThrow({ where: { id: a.casinoId } });
  const sheet = await parseFile(a.fileName, a.data).catch(() => {
    throw new FinanceError("PARSE_FAILED");
  });
  const map = mapStatementHeaders(sheet.headers);
  if (!map.netLoss || (!map.crmNo && !map.playerRef)) throw new FinanceError("COLUMNS_MISSING", `Tanınan sütunlar: ${Object.keys(map).join(", ") || "yok"}`);
  const lines = normalizeStatementRows(sheet.rows, map, { invertSign: a.invertSign, period: a.period });
  const sha256 = createHash("sha256").update(a.data).digest("hex");
  if (await db.casinoStatement.findFirst({ where: { casinoId: a.casinoId, sha256 } })) throw new FinanceError("DUPLICATE_STATEMENT");

  // Eşleme: CRM no (veya casino oyuncu no → dış kimlik) → bu casinonun dönem tripleri
  const { start, end } = periodRange(a.period);
  const tripGuests = await db.tripGuest.findMany({ where: { trip: { casinoId: a.casinoId, startDate: { lte: end }, endDate: { gte: start } } }, select: { id: true, crmNo: true, guestId: true } });
  const byCrm = new Map(tripGuests.map((t) => [t.crmNo, t]));
  const refs = [...new Set(lines.map((l) => l.playerRef).filter((x): x is string => !!x))];
  const ext = refs.length ? await db.guestExternalId.findMany({ where: { value: { in: refs } }, select: { value: true, guest: { select: { crmNo: true } } } }) : [];
  const crmByRef = new Map(ext.map((e) => [e.value, e.guest.crmNo]));

  const rows = lines.map((l) => {
    const crm = l.crmNo ?? (l.playerRef ? crmByRef.get(l.playerRef) ?? null : null);
    const tg = crm ? byCrm.get(crm) : undefined;
    const match = l.issue ? "INVALID" : !crm ? "UNMATCHED" : !tg ? "NOT_IN_TRIP" : "MATCHED";
    return { ...l, crmNo: crm, tripGuestId: tg?.id ?? null, match };
  });
  const storageKey = await putEncrypted("statements", a.data);
  const totals = {
    netLoss: fromKurus(rows.reduce((s, r) => s + r.netLoss, 0)),
    rolling: fromKurus(rows.reduce((s, r) => s + (r.rolling ?? 0), 0)),
    lines: rows.length,
    matched: rows.filter((r) => r.match === "MATCHED").length,
    unmatched: rows.filter((r) => r.match !== "MATCHED").length,
    mapping: map,
    invertSign: a.invertSign,
  };
  const st = await db.casinoStatement.create({
    data: {
      casinoId: a.casinoId, period: a.period, fileName: a.fileName.slice(0, 200), sha256, storageKey, currency: casino.currency, totals, uploadedBy: user.id,
      lines: {
        create: rows.map((r) => ({
          rowNo: r.rowNo, crmNo: r.crmNo, playerRef: r.playerRef, name: r.name, playedOn: r.playedOn ? new Date(`${r.playedOn}T12:00:00+03:00`) : null,
          netLoss: new Prisma.Decimal(fromKurus(r.netLoss)), rolling: r.rolling === null ? null : new Prisma.Decimal(fromKurus(r.rolling)), tripGuestId: r.tripGuestId, match: r.match, issue: r.issue,
        })),
      },
    },
  });
  await audit({ actorId: user.id, action: "finance.statement.import", entity: "CasinoStatement", entityId: st.id, diff: { period: a.period, sha256, lines: rows.length, matched: totals.matched } });
  return st;
}

/**
 * Ekstreyi sonuç olarak işle: eşleşen satırlar kaynak referansıyla (ekstre + satır no) GamingResult olur.
 * Aynı ekstre iki kez işlenmez; dönem kilitliyse reddedilir.
 */
export async function applyStatement(user: Principal, statementId: string) {
  const st = await db.casinoStatement.findUniqueOrThrow({ where: { id: statementId }, include: { lines: true } });
  if (st.status !== "IMPORTED") throw new FinanceError("BAD_STATE");
  if (st.uploadedBy === user.id) throw new FinanceError("SAME_PERSON");
  const period = await db.commissionPeriod.upsert({ where: { casinoId_period: { casinoId: st.casinoId, period: st.period } }, update: {}, create: { casinoId: st.casinoId, period: st.period } });
  if (period.status === "LOCKED") throw new FinanceError("PERIOD_LOCKED");
  const lines = st.lines.filter((l) => l.match === "MATCHED" && l.tripGuestId);
  await db.$transaction(async (tx) => {
    for (const l of lines) {
      const r = await tx.gamingResult.create({
        data: {
          tripGuestId: l.tripGuestId!, periodId: period.id, playedOn: l.playedOn ?? new Date(`${st.period}-15T12:00:00+03:00`), netLoss: l.netLoss, rolling: l.rolling, currency: st.currency,
          source: "STATEMENT", sourceRef: `ekstre:${st.id}#${l.rowNo}`, enteredBy: user.id,
        },
      });
      await tx.statementLine.update({ where: { id: l.id }, data: { resultId: r.id } });
    }
    await tx.casinoStatement.update({ where: { id: st.id }, data: { status: "APPLIED", appliedBy: user.id, appliedAt: new Date() } });
  });
  await audit({ actorId: user.id, action: "finance.statement.apply", entity: "CasinoStatement", entityId: st.id, diff: { results: lines.length } });
  return lines.length;
}

/** Dönem mutabakatı: ekstre (misafir bazında) ↔ girilen sonuçlar (ekstreden işlenenler hariç) ve motor ↔ hesap. */
export async function reconciliation(periodId: string, statementId: string) {
  const p = await db.commissionPeriod.findUniqueOrThrow({ where: { id: periodId } });
  const st = await db.casinoStatement.findUniqueOrThrow({ where: { id: statementId }, include: { lines: true } });
  if (st.casinoId !== p.casinoId || st.period !== p.period) throw new FinanceError("STATEMENT_MISMATCH");
  // Dikkat: NOT(startsWith) SQL'de NULL'ları da dışlar; kaynak referansı boş (elle girilmiş) sonuçlar açıkça dahil edilir
  const results = await db.gamingResult.findMany({
    where: { periodId, OR: [{ sourceRef: null }, { NOT: { sourceRef: { startsWith: `ekstre:${st.id}#` } } }] },
    include: { tripGuest: { select: { crmNo: true, guestName: true } } },
  });
  const agg = <T,>(xs: T[], key: (x: T) => string, name: (x: T) => string, nl: (x: T) => number, rl: (x: T) => number): GuestTotals[] => {
    const m = new Map<string, GuestTotals>();
    for (const x of xs) {
      const k = key(x);
      const g = m.get(k) ?? { key: k, name: name(x), netLoss: 0, rolling: 0 };
      g.netLoss += nl(x);
      g.rolling += rl(x);
      m.set(k, g);
    }
    return [...m.values()];
  };
  const stmt = agg(st.lines.filter((l) => l.crmNo !== null && l.match !== "INVALID"), (l) => String(l.crmNo), (l) => l.name ?? "", (l) => toKurus(l.netLoss.toString()), (l) => (l.rolling ? toKurus(l.rolling.toString()) : 0));
  const entered = agg(results, (r) => String(r.tripGuest.crmNo), (r) => r.tripGuest.guestName, (r) => toKurus(r.netLoss.toString()), (r) => (r.rolling ? toKurus(r.rolling.toString()) : 0));
  const rec = reconcile(stmt, entered);
  return { ...rec, unmatchedLines: st.lines.filter((l) => l.match !== "MATCHED").length, statement: { id: st.id, fileName: st.fileName, sha256: st.sha256, status: st.status } };
}

/**
 * Mutabakat sonucu hesaba işlenir (APPROVED → RECONCILED): ekstre seçilir, özet hesaba yazılır;
 * fark varsa gerekçe zorunlu. Hazırlayan mutabakat yapamaz.
 */
export async function reconcileCalculation(user: Principal, calcId: string, statementId: string, reason?: string) {
  const calc = await db.commissionCalculation.findUniqueOrThrow({ where: { id: calcId }, include: { period: true } });
  if (calc.status !== "APPROVED") throw new FinanceError("BAD_STATE");
  if (calc.period.status === "LOCKED") throw new FinanceError("PERIOD_LOCKED");
  if (calc.preparedBy === user.id) throw new FinanceError("SAME_PERSON");
  const rec = await reconciliation(calc.periodId, statementId);
  if (!rec.clean && (reason ?? "").trim().length < 5) throw new FinanceError("RECON_REASON_REQUIRED");
  const summary = { counts: rec.counts, statementTotal: fromKurus(rec.statementTotal), enteredTotal: fromKurus(rec.enteredTotal), totalDiff: fromKurus(rec.totalDiff), clean: rec.clean, unmatchedLines: rec.unmatchedLines, sha256: rec.statement.sha256, reason: reason?.trim() || null };
  await db.commissionCalculation.update({
    where: { id: calc.id },
    data: { status: "RECONCILED", statementId, statementRef: `${rec.statement.fileName} (${rec.statement.sha256.slice(0, 12)})`, reconcileSummary: summary, reconciledBy: user.id, reconciledAt: new Date() },
  });
  await audit({ actorId: user.id, action: "finance.calc.reconcile", entity: "CommissionCalculation", entityId: calc.id, reason, diff: summary });
}

// ───────────── Anomali raporu ─────────────

export async function financeAnomalies(periodId: string) {
  const results = await db.gamingResult.findMany({ where: { periodId }, include: { tripGuest: { select: { crmNo: true } } } });
  const findings = financeFindings(results.map((r) => ({
    id: r.id, tripGuestId: r.tripGuestId, crmNo: r.tripGuest.crmNo, playedOn: r.playedOn.toISOString().slice(0, 10), netLoss: toKurus(r.netLoss.toString()),
    source: r.source, sourceRef: r.sourceRef, enteredAt: r.enteredAt,
  })));
  const calcs = await db.commissionCalculation.findMany({ where: { periodId, status: { not: "CANCELLED" } }, select: { id: true, version: true, amount: true, engineAmount: true, status: true } });
  const engineDiffs = calcs.filter((c) => c.engineAmount && !c.amount.equals(c.engineAmount)).map((c) => ({ calcId: c.id, version: c.version, status: c.status, amount: c.amount.toString(), engineAmount: c.engineAmount!.toString() }));
  return { findings, engineDiffs };
}

/** Operasyon anomalileri: ekip + gün bazında (kişi bazlı değil), son `days` gün. */
export async function opsAnomalies(days = 14, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const calls = await db.call.findMany({
    where: { startedAt: { gte: since }, closedAt: { not: null } },
    select: { startedAt: true, talkSec: true, disposition: true, autoClosed: true, agentId: true, agent: { select: { teamId: true } } },
  });
  // Yayınlanmış vardiya pencereleri (kullanıcıya bağlı personel)
  const emps = await db.employee.findMany({ where: { userId: { in: [...new Set(calls.map((c) => c.agentId))] } }, select: { id: true, userId: true } });
  const empOf = new Map(emps.map((e) => [e.userId!, e.id]));
  const assignments = await db.rosterAssignment.findMany({
    where: { employeeId: { in: emps.map((e) => e.id) }, date: { gte: new Date(since.toISOString().slice(0, 10) + "T00:00:00Z") }, roster: { publishedAt: { not: null } } },
    select: { employeeId: true, date: true, kind: true, startMin: true, endMin: true },
  });
  const plan = new Map(assignments.map((a) => [`${a.employeeId}|${a.date.toISOString().slice(0, 10)}`, a]));
  const ist = (d: Date) => new Date(d.getTime() + 3 * 3600_000);
  const rows = new Map<string, CallDayRow>();
  for (const c of calls) {
    const day = ist(c.startedAt).toISOString().slice(0, 10);
    const teamId = c.agent.teamId;
    const k = `${day}|${teamId}`;
    const r = rows.get(k) ?? { day, teamId, calls: 0, reachedZeroTalk: 0, autoClosed: 0, outsideShift: 0 };
    r.calls++;
    if (c.disposition === "REACHED" && !c.talkSec) r.reachedZeroTalk++;
    if (c.autoClosed) r.autoClosed++;
    const emp = empOf.get(c.agentId);
    const a = emp ? plan.get(`${emp}|${day}`) : undefined;
    if (a) {
      const minute = ist(c.startedAt).getUTCHours() * 60 + ist(c.startedAt).getUTCMinutes();
      const inside = a.kind === "WORK" && a.startMin != null && a.endMin != null && (a.endMin > a.startMin ? minute >= a.startMin - 30 && minute <= a.endMin + 30 : minute >= a.startMin - 30 || minute <= a.endMin + 30);
      if (!inside) r.outsideShift++;
    }
    rows.set(k, r);
  }
  const teams = new Map((await db.team.findMany({ select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  return opsFindings([...rows.values()]).map((f) => ({ ...f, teamName: f.teamId ? teams.get(f.teamId) ?? "—" : "Ekipsiz" }));
}

export { nextPeriod };
