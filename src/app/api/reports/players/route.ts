import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { can, getPrincipal } from "@/server/auth/rbac";
import { logAccess } from "@/server/audit";
import { canPlayerReports, playersReport } from "@/server/services/analytics";
import { todayIso } from "@/server/services/reports";

/** Oyuncu ve trip raporu dışa aktarımı: rapor + oyuncu görüntüleme + dışa aktarma yetkisi, gerekçe, erişim kaydı. Kimlik alanı içermez. */
export async function GET(req: Request) {
  const user = await getPrincipal();
  if (!user) return new NextResponse("Oturum yok", { status: 401 });
  if (!canPlayerReports(user) || !can(user, "guest.view") || !(can(user, "export.basic") || can(user, "export.bulk"))) {
    await logAccess({ actorId: user.id, action: "denied", resource: "export:report.players" });
    return new NextResponse("Yetkisiz", { status: 403 });
  }
  const url = new URL(req.url);
  const reason = (url.searchParams.get("reason") ?? "").trim();
  if (reason.length < 5 || reason.length > 300) return new NextResponse("Dışa aktarma gerekçesi zorunlu (en az 5 karakter).", { status: 400 });
  const iso = (s: string | null, d: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : d);
  const to = iso(url.searchParams.get("to"), todayIso());
  const from = iso(url.searchParams.get("from"), to);
  const casinoId = url.searchParams.get("casino") || undefined;
  const country = /^[A-Z]{2}$/.test(url.searchParams.get("country") ?? "") ? url.searchParams.get("country")! : undefined;
  const r = await playersReport(user, { from, to, casinoId, country });
  const rows = r.players ?? [];
  if (!can(user, "export.bulk") && rows.length > 1000) return new NextResponse("Satır sınırı aşıldı", { status: 413 });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Oyuncular");
  ws.addRow([`Trip başlangıcı: ${from} – ${to}${country ? ` · ülke ${country}` : ""}`]);
  ws.addRow(["Oyuncu", "CRM no", "Ülke", "Trip sayısı", "Son trip", "Casinolar", "Yeni oyuncu"]).font = { bold: true };
  for (const p of rows) ws.addRow([p.name, `CRM-${String(p.crmNo).padStart(6, "0")}`, p.country ?? "", p.trips, p.lastTrip.toISOString().slice(0, 10), p.casinos.join(", "), p.isNew ? "Evet" : "Hayır"]);
  ws.columns.forEach((c) => (c.width = 20));
  await logAccess({ actorId: user.id, action: "export", resource: "report.players", reason, meta: { from, to, casinoId: casinoId ?? null, country: country ?? null, rows: rows.length } });
  const data = Buffer.from(await wb.xlsx.writeBuffer());
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="oyuncu-raporu-${from}-${to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
