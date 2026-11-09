import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { can, getPrincipal } from "@/server/auth/rbac";
import { logAccess } from "@/server/audit";
import { getDecrypted } from "@/server/storage";
import { callScopeWhere } from "@/server/services/call-detail";
import { activeGrant } from "@/server/services/recordings";

/**
 * Ses akışı: yalnız süreli dinleme izni (gerekçeli) olan kullanıcıya. İndirme ayrı izin ister
 * (recording.download — varsayılan rollerde yok). Her istek erişim kaydına yazılır.
 */
export async function GET(req: Request, { params }: { params: Promise<{ callId: string }> }) {
  const user = await getPrincipal();
  if (!user) return new NextResponse("Oturum yok", { status: 401 });
  const { callId } = await params;
  const download = new URL(req.url).searchParams.get("download") === "1";

  const visible = await db.call.count({ where: { AND: [{ id: callId }, callScopeWhere(user)] } });
  const allowed = download ? can(user, "recording.download") : can(user, "recording.listen") && !!(await activeGrant(user.id, callId));
  if (!visible || !allowed) {
    await logAccess({ actorId: user.id, action: "denied", resource: download ? "Recording:download" : "Recording:listen", resourceId: callId });
    return new NextResponse("Yetkisiz", { status: 403 });
  }
  const rec = await db.recording.findUnique({ where: { callId } });
  if (!rec || rec.status !== "STORED" || !rec.storageKey) return new NextResponse("Kayıt yok", { status: 404 });

  const audio = await getDecrypted(rec.storageKey);
  await logAccess({ actorId: user.id, action: download ? "download" : "listen", resource: "Recording", resourceId: callId, meta: { bytes: audio.length } });
  return new NextResponse(new Uint8Array(audio), {
    headers: {
      "Content-Type": rec.mimeType ?? "audio/mpeg",
      "Cache-Control": "no-store",
      ...(download ? { "Content-Disposition": `attachment; filename="cagri-${callId}.audio"` } : { "Content-Disposition": "inline" }),
    },
  });
}
