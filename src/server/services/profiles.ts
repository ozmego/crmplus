import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { can, guestScopeWhere, type Principal } from "@/server/auth/rbac";
import { financeView } from "@/server/services/finance";

/**
 * Oyuncu ve casino (lokasyon) profilleri.
 * Kural (plan v4 §8): kayıp/kazanç, rolling ve komisyon yalnız finans yetkisiyle okunur ve her görüntüleme
 * "finance:" erişim kaydına yazılır. Trip katılımı (ad, casino, tarih, durum) tutar içermez; oyuncuyu görme
 * yetkisi olanlara gösterilir. Bu veriler hedefleme, öncelik veya segment için kullanılmaz.
 */

export class ProfileError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const sumByCurrency = (rows: { currency: string; v: Prisma.Decimal | null }[]) => {
  const m = new Map<string, Prisma.Decimal>();
  for (const r of rows) if (r.v !== null) m.set(r.currency, (m.get(r.currency) ?? new Prisma.Decimal(0)).add(r.v));
  return [...m.entries()].map(([currency, total]) => ({ currency, total: total.toString() }));
};

/** Oyuncunun trip katılımları — tutar yok. Çağıran oyuncuyu görme yetkisini zaten doğrulamış olmalı. */
export async function tripAttendance(guestId: string) {
  const rows = await db.tripGuest.findMany({
    where: { guestId },
    select: { trip: { select: { id: true, name: true, startDate: true, endDate: true, status: true, casino: { select: { id: true, name: true, country: true } } } } },
  });
  return rows.map((r) => r.trip).sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
}

/** Oyuncu profili başlığı: oyuncuyu görme yetkisi (kapsamla) veya finans yetkisi (yalnız ad + CRM no). */
export async function profileHeader(user: Principal, guestId: string) {
  if (can(user, "guest.view")) {
    const g = await db.guest.findFirst({ where: { AND: [{ id: guestId }, guestScopeWhere(user, "guest.view")] }, select: { id: true, crmNo: true, firstName: true, lastName: true } });
    if (g) return { ...g, viaFinanceOnly: false };
  }
  if (can(user, "finance.view")) {
    // Finans misafir verisinden yalnız ad ve CRM no okur (docs/06); yalnız tripte yer alan oyuncular
    const tg = await db.tripGuest.findFirst({ where: { guestId }, select: { guestId: true, crmNo: true, guestName: true } });
    if (tg) {
      const [firstName, ...rest] = tg.guestName.split(" ");
      return { id: tg.guestId, crmNo: tg.crmNo, firstName, lastName: rest.join(" "), viaFinanceOnly: true };
    }
  }
  return null;
}

/** Finans sekmesi: oyuncunun trip bazında oyun sonuçları ve para birimi bazında toplamlar. */
export async function guestFinance(user: Principal, guestId: string) {
  if (!can(user, "finance.view")) throw new ProfileError("FORBIDDEN");
  await financeView(user, "guest", guestId);
  const tgs = await db.tripGuest.findMany({
    where: { guestId },
    select: {
      id: true,
      trip: { select: { id: true, name: true, startDate: true, casino: { select: { name: true, currency: true } } } },
      results: {
        orderBy: { playedOn: "asc" },
        select: { id: true, playedOn: true, netLoss: true, rolling: true, buyIn: true, cashOut: true, currency: true, source: true, sourceRef: true, period: { select: { id: true, period: true, status: true } } },
      },
    },
  });
  const all = tgs.flatMap((t) => t.results);
  return {
    trips: tgs.sort((a, b) => b.trip.startDate.getTime() - a.trip.startDate.getTime()),
    totals: {
      netLoss: sumByCurrency(all.map((r) => ({ currency: r.currency, v: r.netLoss }))),
      rolling: sumByCurrency(all.map((r) => ({ currency: r.currency, v: r.rolling }))),
      results: all.length,
    },
  };
}

// ───────────── Casino (lokasyon) profilleri ─────────────

export function canSeeLocations(user: Principal) {
  return can(user, "finance.view") || can(user, "report.product");
}

export async function locationList() {
  const now = new Date();
  const casinos = await db.casino.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, country: true, currency: true,
      trips: { select: { startDate: true, endDate: true, status: true, _count: { select: { guests: true } } } },
    },
  });
  const players = await db.$queryRaw<{ casinoId: string; n: bigint }[]>`
    SELECT t."casinoId", count(DISTINCT g."guestId") AS n FROM finance."TripGuest" g JOIN finance."Trip" t ON t.id = g."tripId" GROUP BY t."casinoId"`;
  const playersBy = new Map(players.map((p) => [p.casinoId, Number(p.n)]));
  return casinos.map((c) => {
    const active = c.trips.filter((t) => t.status !== "CANCELLED");
    const upcoming = active.filter((t) => t.startDate >= now).sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    const last = active.filter((t) => t.startDate < now).sort((a, b) => b.startDate.getTime() - a.startDate.getTime())[0];
    return {
      id: c.id, name: c.name, country: c.country, currency: c.currency,
      trips: active.length,
      upcoming: upcoming.length,
      nextTrip: upcoming[0]?.startDate ?? null,
      lastTrip: last?.startDate ?? null,
      players: playersBy.get(c.id) ?? 0,
    };
  });
}

/** Casino profili. Sözleşme, dönem, ekstre ve sonuç toplamları yalnız finans yetkisiyle (erişim kaydıyla). */
export async function locationProfile(user: Principal, casinoId: string) {
  const casino = await db.casino.findUnique({
    where: { id: casinoId },
    select: {
      id: true, name: true, country: true, currency: true, createdAt: true,
      trips: { orderBy: { startDate: "desc" }, select: { id: true, name: true, startDate: true, endDate: true, status: true, _count: { select: { guests: true } } } },
    },
  });
  if (!casino) return null;

  const tgs = await db.tripGuest.findMany({
    where: { trip: { casinoId } },
    select: { guestId: true, crmNo: true, guestName: true, trip: { select: { startDate: true, status: true } } },
  });
  const byGuest = new Map<string, { guestId: string; crmNo: number; name: string; trips: number; lastTrip: Date }>();
  for (const t of tgs) {
    if (t.trip.status === "CANCELLED") continue;
    const cur = byGuest.get(t.guestId);
    if (!cur) byGuest.set(t.guestId, { guestId: t.guestId, crmNo: t.crmNo, name: t.guestName, trips: 1, lastTrip: t.trip.startDate });
    else {
      cur.trips++;
      if (t.trip.startDate > cur.lastTrip) cur.lastTrip = t.trip.startDate;
    }
  }
  // Oyuncu adları yalnız oyuncuyu görme yetkisi (kapsamıyla) veya finans yetkisi olana; diğerlerine yalnız sayı
  let players: { guestId: string; crmNo: number; name: string; trips: number; lastTrip: Date; linkable: boolean }[] = [];
  if (can(user, "finance.view") || can(user, "guest.view")) {
    const visibleIds = can(user, "guest.view")
      ? new Set((await db.guest.findMany({ where: { AND: [{ id: { in: [...byGuest.keys()] } }, guestScopeWhere(user, "guest.view")] }, select: { id: true } })).map((g) => g.id))
      : new Set<string>();
    players = [...byGuest.values()]
      .filter((p) => can(user, "finance.view") || visibleIds.has(p.guestId))
      .map((p) => ({ ...p, linkable: visibleIds.has(p.guestId) || can(user, "finance.view") }))
      .sort((a, b) => b.lastTrip.getTime() - a.lastTrip.getTime());
  }

  let finance: null | {
    contracts: { id: string; name: string; version: number | null; validFrom: Date | null; combine: string | null }[];
    periods: { id: string; period: string; status: string }[];
    statements: { id: string; period: string; fileName: string; status: string; uploadedAt: Date; appliedAt: Date | null }[];
    totals: { netLoss: { currency: string; total: string }[]; rolling: { currency: string; total: string }[]; results: number };
  } = null;
  if (can(user, "finance.view")) {
    await financeView(user, "casino", casinoId);
    const [contracts, periods, statements, results] = await Promise.all([
      db.contract.findMany({ where: { casinoId }, select: { id: true, name: true, versions: { orderBy: { version: "desc" }, take: 1, select: { version: true, validFrom: true, combine: true } } } }),
      db.commissionPeriod.findMany({ where: { casinoId }, orderBy: { period: "desc" }, take: 12, select: { id: true, period: true, status: true } }),
      db.casinoStatement.findMany({ where: { casinoId }, orderBy: { uploadedAt: "desc" }, take: 6, select: { id: true, period: true, fileName: true, status: true, uploadedAt: true, appliedAt: true } }),
      db.gamingResult.findMany({ where: { tripGuest: { trip: { casinoId } } }, select: { netLoss: true, rolling: true, currency: true } }),
    ]);
    finance = {
      contracts: contracts.map((c) => ({ id: c.id, name: c.name, version: c.versions[0]?.version ?? null, validFrom: c.versions[0]?.validFrom ?? null, combine: c.versions[0]?.combine ?? null })),
      periods,
      statements,
      totals: {
        netLoss: sumByCurrency(results.map((r) => ({ currency: r.currency, v: r.netLoss }))),
        rolling: sumByCurrency(results.map((r) => ({ currency: r.currency, v: r.rolling }))),
        results: results.length,
      },
    };
  }

  return { casino, playerCount: byGuest.size, players, finance };
}
