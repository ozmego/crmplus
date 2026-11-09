import { NextResponse } from "next/server";

/**
 * YALNIZ GELİŞTİRME/TEST: santralin kayıt indirme adresini taklit eder (sahte ses baytları).
 * Üretimde 404 döner.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") return new NextResponse("Bulunamadı", { status: 404 });
  const bytes = Buffer.alloc(4096);
  bytes.write("ID3", 0); // MP3 benzeri başlık; mock transkript motoru içeriği okumaz
  for (let i = 3; i < bytes.length; i++) bytes[i] = (i * 31) % 256;
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "audio/mpeg" } });
}
