import { NextResponse } from "next/server";
import { getPrincipal } from "@/server/auth/rbac";
import { logAccess } from "@/server/audit";
import { getDecrypted } from "@/server/storage";
import { openDocument, ProfileEditError } from "@/server/services/casino-profile";

/**
 * Oyuncu belgesi görüntüleme: field.identity + oyuncu kapsamı + gerekçe (?reason=); her açılış erişim kaydına yazılır.
 * Tarayıcıda görüntülenir (inline), önbelleğe alınmaz. Profil kaydı sistem dışına aktarılmaz.
 */
export async function GET(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const user = await getPrincipal();
  if (!user) return new NextResponse("Oturum yok", { status: 401 });
  const { docId } = await params;
  const reason = new URL(req.url).searchParams.get("reason") ?? "";
  try {
    const doc = await openDocument(user, docId, reason);
    const data = await getDecrypted(doc.storageKey);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": doc.mime,
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.fileName)}"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof ProfileEditError) {
      if (e.code === "FORBIDDEN") await logAccess({ actorId: user.id, action: "denied", resource: "guest.document", resourceId: docId });
      const status = e.code === "FORBIDDEN" ? 403 : e.code === "REASON_REQUIRED" ? 400 : 404;
      return new NextResponse(e.code === "REASON_REQUIRED" ? "Görüntüleme gerekçesi zorunlu (en az 5 karakter)." : "Erişim yok", { status });
    }
    throw e;
  }
}
