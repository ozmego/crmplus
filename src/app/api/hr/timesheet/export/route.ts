import { NextResponse } from "next/server";
import { requirePermission, ForbiddenError } from "@/server/auth/rbac";
import { HrError } from "@/server/services/hr";
import { exportMonth } from "@/server/services/timesheet";

/** Aylık puantaj Excel'i: ayrı izin + gerekçe + AccessLog (docs/11 §9). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? "";
  const scope = url.searchParams.get("scope") ?? "";
  const reason = url.searchParams.get("reason") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month) || !scope) return new NextResponse("Ay ve kapsam gerekli", { status: 400 });
  try {
    const user = await requirePermission("timesheet.export", "timesheet.export");
    const { buffer, fileName } = await exportMonth(user, month, scope, reason);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError || (e instanceof HrError && e.code === "FORBIDDEN")) return new NextResponse("Yetkisiz", { status: 403 });
    if (e instanceof HrError) return new NextResponse(e.code === "REASON_REQUIRED" ? "Gerekçe zorunlu (en az 5 karakter)" : e.code, { status: 400 });
    throw e;
  }
}
