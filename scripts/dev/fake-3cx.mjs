/**
 * Geliştirme için sahte 3CX V20 santrali (bağımlılıksız). Gerçek santral olmadan crmPlus 3CX akışını sınar.
 *   node scripts/dev/fake-3cx.mjs            → http://127.0.0.1:5090
 * Ortam: FAKE3CX_PORT (5090) · FAKE3CX_ID (crmplus) · FAKE3CX_SECRET (secret) · FAKE3CX_DNS (101,102) · FAKE3CX_TALK (6 sn)
 * crmPlus tarafı: PBX_PROVIDER=3cx THREECX_URL=http://127.0.0.1:5090 THREECX_CLIENT_ID=crmplus THREECX_CLIENT_SECRET=secret
 *
 * Senaryo: makecall → katılımcı "Dialing" → 3 sn sonra "Connected" → FAKE3CX_TALK sn sonra kaldırılır.
 * Hedef numara "…0000" ile bitiyorsa misafir açmaz (8 sn sonra kaldırılır).
 */
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";

const PORT = Number(process.env.FAKE3CX_PORT ?? 5090);
const ID = process.env.FAKE3CX_ID ?? "crmplus";
const SECRET = process.env.FAKE3CX_SECRET ?? "secret";
const DNS = (process.env.FAKE3CX_DNS ?? "101,102").split(",");
const TALK = Number(process.env.FAKE3CX_TALK ?? 6) * 1000;

const tokens = new Set();
const participants = new Map(); // `${dn}/${id}` → participant
const sockets = new Set();
let seq = 0, nextCall = 9000, nextPart = 1;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), "[sahte-3cx]", ...a);

function frame(text) {
  const p = Buffer.from(text);
  const head = p.length < 126 ? Buffer.from([0x81, p.length]) : Buffer.from([0x81, 126, p.length >> 8, p.length & 255]);
  return Buffer.concat([head, p]);
}
function broadcast(type, entity) {
  const msg = JSON.stringify({ sequence: ++seq, event: { event_type: type, entity, attached_data: null } });
  for (const s of sockets) s.write(frame(msg));
}
function upsert(p) {
  participants.set(`${p.dn}/${p.id}`, p);
  broadcast(0, `/callcontrol/${p.dn}/participants/${p.id}`);
  log(`katılımcı ${p.dn}/${p.id} çağrı ${p.callid}: ${p.status}`);
}
function remove(p) {
  participants.delete(`${p.dn}/${p.id}`);
  broadcast(1, `/callcontrol/${p.dn}/participants/${p.id}`);
  log(`katılımcı ${p.dn}/${p.id} çağrı ${p.callid}: kapandı`);
}
const authed = (req) => tokens.has((req.headers.authorization ?? "").replace(/^Bearer /, ""));
const json = (res, code, body) => res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(body));

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    if (req.method === "POST" && url.pathname === "/connect/token") {
      const f = new URLSearchParams(body);
      if (f.get("client_id") !== ID || f.get("client_secret") !== SECRET) return json(res, 400, { error: "invalid_client" });
      const t = randomBytes(16).toString("hex");
      tokens.add(t);
      return json(res, 200, { access_token: t, token_type: "Bearer", expires_in: 3600 });
    }
    if (!authed(req)) return json(res, 401, { error: "unauthorized" });
    if (req.method === "GET" && url.pathname === "/callcontrol") {
      return json(res, 200, DNS.map((dn) => ({ dn, type: "Wextension", participants: [...participants.values()].filter((p) => p.dn === dn) })));
    }
    let m = /^\/callcontrol\/([^/]+)\/makecall$/.exec(url.pathname);
    if (req.method === "POST" && m) {
      const dn = m[1];
      if (!DNS.includes(dn)) return json(res, 404, { error: "DN not found" });
      const { destination } = JSON.parse(body || "{}");
      const p = { id: nextPart++, dn, status: "Dialing", callid: nextCall++, legid: 1, party_dn: destination, party_caller_id: destination };
      log(`makecall ${dn} → ${destination} (çağrı ${p.callid})`);
      setTimeout(() => upsert({ ...p }), 500);
      const noAnswer = String(destination).endsWith("0000");
      if (noAnswer) setTimeout(() => remove(p), 8000);
      else {
        setTimeout(() => upsert({ ...p, status: "Connected" }), 3000);
        setTimeout(() => remove(p), 3000 + TALK);
      }
      return json(res, 200, { finalstatus: "Success", reason: "", result: p });
    }
    m = /^\/callcontrol\/([^/]+)\/participants\/(\d+)$/.exec(url.pathname);
    if (req.method === "GET" && m) {
      const p = participants.get(`${m[1]}/${m[2]}`);
      return p ? json(res, 200, p) : json(res, 404, { error: "not found" });
    }
    json(res, 404, { error: "not found" });
  });
});

server.on("upgrade", (req, socket) => {
  if (new URL(req.url, "http://x").pathname !== "/callcontrol/ws" || !authed(req)) {
    socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return;
  }
  const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sockets.add(socket);
  log("olay akışına bir istemci bağlandı");
  socket.on("data", (buf) => {
    if ((buf[0] & 0x0f) === 0x8) socket.end(); // kapatma çerçevesi
  });
  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => sockets.delete(socket));
});

server.listen(PORT, "127.0.0.1", () => log(`http://127.0.0.1:${PORT} · dahililer ${DNS.join(", ")}`));
