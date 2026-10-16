// HTTP + WebSocket-server. I produktion serverar den även den byggda klienten (dist/),
// så hela spelet kan driftas som en enda Node-process.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { PROTOCOL_VERSION, WS_PATH, type ServerMsg } from "../shared/protocol.ts";
import { LIMITS, RateLimiter } from "./limits.ts";
import { RoomManager, type Conn } from "./rooms.ts";
import { parseClientMsg } from "./validate.ts";

const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve(import.meta.dirname, "../dist");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

const rooms = new RoomManager();
const connectionsPerIp = new Map<string, number>();
let shuttingDown = false;

const http = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  if (path === "/health") {
    res.writeHead(shuttingDown ? 503 : 200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: !shuttingDown, rooms: rooms.roomCount, version: PROTOCOL_VERSION }));
  }
  if (!existsSync(DIST)) {
    res.writeHead(404);
    return res.end("Klienten är inte byggd. Kör `npm run dev` (utveckling) eller `npm run build` först.");
  }
  // Statiska filer, annars index.html så att länkar som /r/ABCD fungerar.
  let file = join(DIST, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "cache-control": file.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server: http, path: WS_PATH, maxPayload: 4096 });
const alive = new WeakSet<WebSocket>();

wss.on("connection", (ws, req) => {
  const ip = clientIp(req);
  const send = (msg: ServerMsg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

  // Gammal klient efter en driftsättning: be den ladda om i stället för att missförstå meddelanden.
  const version = Number(new URL(req.url ?? "", "http://x").searchParams.get("v"));
  if (version !== PROTOCOL_VERSION) {
    send({ t: "error", code: "outdated", message: "Det finns en ny version av spelet." });
    return ws.close(4000, "outdated");
  }
  const open = (connectionsPerIp.get(ip) ?? 0) + 1;
  if (open > LIMITS.connectionsPerIp) {
    send({ t: "error", code: "rate_limited", message: "För många anslutningar från din adress." });
    return ws.close(1008, "too many connections");
  }
  connectionsPerIp.set(ip, open);

  alive.add(ws);
  ws.on("pong", () => alive.add(ws));
  const conn: Conn = { send, ip };
  const limiter = new RateLimiter(LIMITS.msgPerSecond, LIMITS.msgBurst);
  let dropped = 0;

  ws.on("message", (data) => {
    if (!limiter.take()) {
      // Enstaka överskott ignoreras; en klient som spammar kopplas bort.
      if (++dropped > LIMITS.msgBurst * 2) ws.close(1008, "rate limited");
      return;
    }
    const msg = parseClientMsg(String(data));
    if (!msg) return send({ t: "error", code: "bad_request", message: "Ogiltigt meddelande." });
    rooms.handle(conn, msg);
  });
  ws.on("close", () => {
    const left = (connectionsPerIp.get(ip) ?? 1) - 1;
    if (left > 0) connectionsPerIp.set(ip, left);
    else connectionsPerIp.delete(ip);
    rooms.disconnected(conn);
  });
});

/** Bakom en proxy (Fly, Render, Railway) är klientens adress den sista i X-Forwarded-For. */
function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  const last = (Array.isArray(fwd) ? fwd.at(-1) : fwd)?.split(",").at(-1)?.trim();
  return last || req.socket.remoteAddress || "?";
}

// Stäng döda anslutningar (t.ex. mobiler som tappat nätet utan att säga hejdå).
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, 15_000);

// Snygg avstängning vid driftsättning: meddela spelarna i stället för att bara tappa dem.
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: stänger servern`);
  clearInterval(heartbeat);
  rooms.shutdown();
  for (const ws of wss.clients) ws.close(1012, "server restart");
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

http.listen(PORT, () => console.log(`Servern lyssnar på http://localhost:${PORT} (WebSocket ${WS_PATH})`));
