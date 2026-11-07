import { NextResponse } from "next/server";
import { ForbiddenError, requirePermission } from "@/server/auth/rbac";
import { buildErrorReport, ImportError } from "@/server/services/imports";
import { logAccess } from "@/server/audit";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("import.view");
    const { id } = await params;
    const { fileName, data } = await buildErrorReport(user, id);
    await logAccess({ actorId: user.id, action: "export", resource: "ImportErrorReport", resourceId: id });
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse("Yetkisiz", { status: 403 });
    if (e instanceof ImportError) return new NextResponse(e.code, { status: e.code === "NOT_FOUND" ? 404 : 410 });
    throw e;
  }
}
