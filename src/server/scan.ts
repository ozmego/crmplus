import "server-only";
import net from "node:net";

/**
 * ClamAV (clamd) INSTREAM taraması. CLAMAV_HOST tanımlı değilse tarama yapılmaz ve sonuç
 * açıkça "SKIPPED" olarak kaydedilir (geliştirme ortamı). Üretimde CLAMAV_HOST zorunludur.
 */
export type ScanResult = { status: "CLEAN" } | { status: "INFECTED"; signature: string } | { status: "SKIPPED" } | { status: "ERROR"; message: string };

export async function scanBuffer(data: Buffer): Promise<ScanResult> {
  const host = process.env.CLAMAV_HOST;
  if (!host) {
    if (process.env.NODE_ENV === "production") return { status: "ERROR", message: "CLAMAV_HOST yapılandırılmamış" };
    return { status: "SKIPPED" };
  }
  const port = Number(process.env.CLAMAV_PORT ?? 3310);
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let reply = "";
    socket.setTimeout(30_000, () => {
      socket.destroy();
      resolve({ status: "ERROR", message: "ClamAV zaman aşımı" });
    });
    socket.on("error", (e) => resolve({ status: "ERROR", message: e.message }));
    socket.on("data", (d) => (reply += d.toString()));
    socket.on("end", () => {
      const r = reply.replace(/\0/g, "").trim();
      if (r.endsWith("OK")) resolve({ status: "CLEAN" });
      else if (r.includes("FOUND")) resolve({ status: "INFECTED", signature: r.replace(/^stream:\s*/, "").replace(/\s*FOUND$/, "") });
      else resolve({ status: "ERROR", message: r || "Boş yanıt" });
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const CHUNK = 64 * 1024;
      for (let i = 0; i < data.length; i += CHUNK) {
        const part = data.subarray(i, i + CHUNK);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length);
        socket.write(len);
        socket.write(part);
      }
      socket.end(Buffer.alloc(4));
    });
  });
}
