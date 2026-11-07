import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { can, getPrincipal } from "@/server/auth/rbac";
import { logAccess } from "@/server/audit";
import { agentReport, todayIso } from "@/server/services/reports";

/** Personel raporu dışa aktarımı: export izni + kapsam aynı + erişim kaydı (docs/05 §8). */
export async function GET(req: Request) {
  const user = await getPrincipal();
  if (!user) return new NextResponse("Oturum yok", { status: 401 });
  if (!can(user, "report.view") || !(can(user, "export.basic") || can(user, "export.bulk"))) {
    await logAccess({ actorId: user.id, action: "denied", resource: "export:report.agents" });
    return new NextResponse("Yetkisiz", { status: 403 });
  }
  const url = new URL(req.url);
  const reason = (url.searchParams.get("reason") ?? "").trim();
  if (reason.length < 5 || reason.length > 300) return new NextResponse("Dışa aktarma gerekçesi zorunlu (en az 5 karakter).", { status: 400 });
  const valid = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : todayIso());
  const from = valid(url.searchParams.get("from"));
  const to = valid(url.searchParams.get("to"));
  const { rows } = await agentReport(user, from, to);
  if (!can(user, "export.bulk") && rows.length > 1000) return new NextResponse("Satır sınırı aşıldı", { status: 413 });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Personel raporu");
  ws.addRow([`Dönem: ${from} – ${to} (İstanbul)`]);
  ws.addRow([
    "Personel", "Ekip", "Atanan görev", "Tamamlanan görev", "Arama denemesi", "Tekil numara", "Toplam konuşma (sn)", "Ort. konuşma (sn)",
    "Ulaşma oranı", "Ulaşılamama oranı", "Geri arama talebi", "Geri arama zamanında oranı", "İletişim istemiyor", "Ret oranı", "Eksik sonuç oranı", "Eksik not oranı",
  ]).font = { bold: true };
  for (const r of rows) {
    ws.addRow([
      r.name, r.team ?? "", r.assignedTasks, r.doneTasks, r.kpi.attempts, r.kpi.uniqueNumbers, r.kpi.talkSecTotal,
      r.kpi.talkSecAvg === null ? "" : Math.round(r.kpi.talkSecAvg), r.kpi.reachRate ?? "", r.kpi.unreachRate ?? "", r.kpi.callbackRequests,
      r.callbacks.onTimeRate ?? "", r.kpi.dncCount, r.kpi.rejectRate ?? "", r.kpi.missingDispositionRate ?? "", r.kpi.missingNoteRate ?? "",
    ]);
  }
  ws.columns.forEach((c) => (c.width = 18));
  await logAccess({ actorId: user.id, action: "export", resource: "report.agents", reason, meta: { from, to, rows: rows.length } });
  const data = Buffer.from(await wb.xlsx.writeBuffer());
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="personel-raporu-${from}-${to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
