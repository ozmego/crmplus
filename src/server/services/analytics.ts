import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { can, guestScopeWhere, type Principal } from "@/server/auth/rbac";
import { financeView } from "@/server/services/finance";
import { istanbulDayRange } from "@/server/services/reports";

/**
 * Raporlama modülü (docs/05): oyuncu ve trip, casino performansı, çağrı ve kampanya.
 * Kural: kayıp/kazanç, rolling ve komisyon yalnız finans yetkisiyle hesaplanır ve erişim kaydına yazılır;
 * oyuncu adları yalnız oyuncuyu görme yetkisi (kapsamıyla) olanlara listelenir; diğerlerine toplam sayılar.
 */

export interface Range {
  from: string; // YYYY-MM-DD
  to: string;
}

export function canPlayerReports(user: Principal) {
  return can(user, "report.product") || can(user, "finance.view");
}

const month = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit" }).format(d).slice(0, 7);

function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    if (out.length > 60) break;
  }
  return out;
}

const sumDec = (rows: { currency: string; v: Prisma.Decimal | null }[]) => {
  const m = new Map<string, Prisma.Decimal>();
  for (const r of rows) if (r.v !== null) m.set(r.currency, (m.get(r.currency) ?? new Prisma.Decimal(0)).add(r.v));
  return [...m.entries()].map(([currency, total]) => ({ currency, total: total.toString() }));
};

// ───────────── Oyuncu ve trip ─────────────

export async function playersReport(user: Principal, r: Range & { casinoId?: string; country?: string }) {
  const range = istanbulDayRange(r.from, r.to);
  const trips = await db.trip.findMany({
    where: { startDate: range, status: { not: "CANCELLED" }, ...(r.casinoId ? { casinoId: r.casinoId } : {}) },
    select: { id: true, name: true, startDate: true, casino: { select: { id: true, name: true } }, guests: { select: { guestId: true, crmNo: true, guestName: true, country: true } } },
  });
  const sends = trips.flatMap((t) => t.guests.filter((g) => !r.country || g.country === r.country).map((g) => ({ ...g, trip: t })));
  const playerIds = [...new Set(sends.map((s) => s.guestId))];

  // Yeni oyuncu: ilk (iptal olmayan) tripi bu aralıkta olan
  const firstTrips = playerIds.length
    ? await db.$queryRaw<{ guestId: string; first: Date }[]>`
        SELECT g."guestId", min(t."startDate") AS first FROM finance."TripGuest" g JOIN finance."Trip" t ON t.id = g."tripId"
        WHERE t.status <> 'CANCELLED' AND g."guestId" = ANY(${playerIds}::text[]) GROUP BY g."guestId"`
    : [];
  const newIds = new Set(firstTrips.filter((f) => f.first >= range.gte && f.first <= range.lte).map((f) => f.guestId));

  const months = monthsBetween(r.from, r.to);
  const byMonth = months.map((m) => ({ day: `${m}-01`, value: new Set(sends.filter((s) => month(s.trip.startDate) === m).map((s) => s.guestId)).size }));

  const casinoMap = new Map<string, { casinoId: string; casino: string; trips: Set<string>; players: Set<string> }>();
  for (const s of sends) {
    const c = casinoMap.get(s.trip.casino.id) ?? { casinoId: s.trip.casino.id, casino: s.trip.casino.name, trips: new Set(), players: new Set() };
    c.trips.add(s.trip.id);
    c.players.add(s.guestId);
    casinoMap.set(s.trip.casino.id, c);
  }
  const countryMap = new Map<string, Set<string>>();
  for (const s of sends) {
    const k = s.country ?? "—";
    countryMap.set(k, (countryMap.get(k) ?? new Set()).add(s.guestId));
  }

  // Oyuncu listesi: yalnız oyuncuyu görme yetkisi (kapsamıyla) olanlara
  type PlayerRow = { guestId: string; crmNo: number; name: string; country: string | null; trips: number; lastTrip: Date; casinos: string[]; isNew: boolean };
  let players: PlayerRow[] | null = null;
  if (can(user, "guest.view")) {
    const visible = new Set((await db.guest.findMany({ where: { AND: [{ id: { in: playerIds } }, guestScopeWhere(user, "guest.view")] }, select: { id: true } })).map((g) => g.id));
    const map = new Map<string, PlayerRow>();
    for (const s of sends) {
      if (!visible.has(s.guestId)) continue;
      const cur = map.get(s.guestId) ?? { guestId: s.guestId, crmNo: s.crmNo, name: s.guestName, country: s.country, trips: 0, lastTrip: s.trip.startDate, casinos: [], isNew: newIds.has(s.guestId) };
      cur.trips++;
      if (s.trip.startDate > cur.lastTrip) cur.lastTrip = s.trip.startDate;
      if (!cur.casinos.includes(s.trip.casino.name)) cur.casinos.push(s.trip.casino.name);
      map.set(s.guestId, cur);
    }
    players = [...map.values()].sort((a, b) => b.lastTrip.getTime() - a.lastTrip.getTime()).slice(0, 500);
  }

  return {
    kpi: { trips: new Set(sends.map((s) => s.trip.id)).size || trips.length, players: playerIds.length, sends: sends.length, newPlayers: newIds.size, returning: playerIds.length - newIds.size },
    byMonth,
    byCasino: [...casinoMap.values()].map((c) => ({ casinoId: c.casinoId, casino: c.casino, trips: c.trips.size, players: c.players.size })).sort((a, b) => b.players - a.players),
    byCountry: [...countryMap.entries()].map(([country, s]) => ({ country, players: s.size })).sort((a, b) => b.players - a.players),
    players,
  };
}

// ───────────── Casino performansı ─────────────

export async function casinoReport(user: Principal, r: Range) {
  const range = istanbulDayRange(r.from, r.to);
  const casinos = await db.casino.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, country: true, currency: true, trips: { where: { startDate: range, status: { not: "CANCELLED" } }, select: { id: true, _count: { select: { guests: true } } } } },
  });
  const players = await db.$queryRaw<{ casinoId: string; n: bigint }[]>`
    SELECT t."casinoId", count(DISTINCT g."guestId") AS n FROM finance."TripGuest" g JOIN finance."Trip" t ON t.id = g."tripId"
    WHERE t.status <> 'CANCELLED' AND t."startDate" >= ${range.gte} AND t."startDate" <= ${range.lte} GROUP BY t."casinoId"`;
  const playersBy = new Map(players.map((p) => [p.casinoId, Number(p.n)]));
  const rows = casinos.map((c) => ({ casinoId: c.id, casino: c.name, country: c.country, currency: c.currency, trips: c.trips.length, sends: c.trips.reduce((s, t) => s + t._count.guests, 0), players: playersBy.get(c.id) ?? 0 }));

  let finance: null | {
    byCasino: { casinoId: string; casino: string; netLoss: { currency: string; total: string }[]; rolling: { currency: string; total: string }[]; results: number; commission: { currency: string; total: string }[] }[];
    byMonth: { month: string; casino: string; netLoss: string; currency: string }[];
  } = null;
  if (can(user, "finance.view")) {
    await financeView(user, "report.casinos", `${r.from}..${r.to}`);
    const [results, calcs] = await Promise.all([
      db.gamingResult.findMany({ where: { playedOn: range }, select: { netLoss: true, rolling: true, currency: true, playedOn: true, tripGuest: { select: { trip: { select: { casinoId: true } } } } } }),
      db.commissionCalculation.findMany({
        where: { status: { in: ["APPROVED", "RECONCILED"] }, period: { period: { gte: r.from.slice(0, 7), lte: r.to.slice(0, 7) } } },
        select: { amount: true, currency: true, period: { select: { casinoId: true } } },
      }),
    ]);
    finance = {
      byCasino: rows.map((c) => {
        const mine = results.filter((x) => x.tripGuest.trip.casinoId === c.casinoId);
        return {
          casinoId: c.casinoId,
          casino: c.casino,
          netLoss: sumDec(mine.map((x) => ({ currency: x.currency, v: x.netLoss }))),
          rolling: sumDec(mine.map((x) => ({ currency: x.currency, v: x.rolling }))),
          results: mine.length,
          commission: sumDec(calcs.filter((k) => k.period.casinoId === c.casinoId).map((k) => ({ currency: k.currency, v: k.amount }))),
        };
      }),
      byMonth: (() => {
        const m = new Map<string, { month: string; casino: string; currency: string; v: Prisma.Decimal }>();
        for (const x of results) {
          const name = rows.find((c) => c.casinoId === x.tripGuest.trip.casinoId)?.casino ?? "?";
          const k = `${month(x.playedOn)}|${name}|${x.currency}`;
          const cur = m.get(k) ?? { month: month(x.playedOn), casino: name, currency: x.currency, v: new Prisma.Decimal(0) };
          cur.v = cur.v.add(x.netLoss);
          m.set(k, cur);
        }
        return [...m.values()].sort((a, b) => a.month.localeCompare(b.month) || a.casino.localeCompare(b.casino, "tr")).map((x) => ({ month: x.month, casino: x.casino, currency: x.currency, netLoss: x.v.toString() }));
      })(),
    };
  }
  return { rows, finance };
}

// ───────────── Çağrı ve kampanya ─────────────

export async function callsReport(r: Range) {
  const range = istanbulDayRange(r.from, r.to);
  const [calls, dispositions, perDay, campaigns] = await Promise.all([
    db.call.findMany({ where: { startedAt: range }, select: { disposition: true, answeredAt: true, talkSec: true, autoClosed: true } }),
    db.disposition.findMany({ orderBy: { sortOrder: "asc" } }),
    db.$queryRaw<{ d: string; n: bigint }[]>`
      SELECT to_char(("startedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD') AS d, count(*) AS n
      FROM public."Call" WHERE "startedAt" >= ${range.gte} AND "startedAt" <= ${range.lte} GROUP BY 1`,
    db.messageCampaign.findMany({ where: { createdAt: range }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, channel: true, category: true, status: true, createdAt: true } }),
  ]);
  const msgs = campaigns.length
    ? await db.message.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: campaigns.map((c) => c.id) } }, _count: true })
    : [];

  const reachedCodes = new Set(dispositions.filter((d) => d.countsAsReached).map((d) => d.code));
  const byDisposition = dispositions
    .map((d) => ({ code: d.code, label: d.labelTr, count: calls.filter((c) => c.disposition === d.code).length }))
    .filter((d) => d.count > 0);
  const missing = calls.filter((c) => !c.disposition).length;
  const talk = calls.filter((c) => !c.autoClosed).reduce((s, c) => s + (c.talkSec ?? 0), 0);
  const answered = calls.filter((c) => c.answeredAt).length;

  const days: { day: string; value: number }[] = [];
  const byDay = new Map(perDay.map((p) => [p.d, Number(p.n)]));
  for (let d = new Date(`${r.from}T12:00:00Z`); d <= new Date(`${r.to}T12:00:00Z`) && days.length < 400; d = new Date(d.getTime() + 86_400_000)) {
    const k = d.toISOString().slice(0, 10);
    days.push({ day: k, value: byDay.get(k) ?? 0 });
  }

  return {
    kpi: {
      calls: calls.length,
      answered,
      reached: calls.filter((c) => c.disposition && reachedCodes.has(c.disposition)).length,
      reachRate: calls.length ? calls.filter((c) => c.disposition && reachedCodes.has(c.disposition)).length / calls.length : null,
      talkSec: talk,
      avgTalkSec: answered ? talk / answered : null,
      missingDisposition: missing,
    },
    byDisposition,
    perDay: days,
    campaigns: campaigns.map((c) => {
      const counts = Object.fromEntries(msgs.filter((m) => m.campaignId === c.id).map((m) => [m.status, m._count])) as Record<string, number>;
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      return { ...c, total, counts };
    }),
  };
}
