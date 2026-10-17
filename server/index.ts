// HTTP + WebSocket-server. I produktion serverar den även den byggda klienten (dist/),
// så hela spelet kan driftas som en enda Node-process.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import * as v from "valibot";
import { type WebSocket, WebSocketServer } from "ws";
import { ClientErrorSchema, LOG_PATH, PROTOCOL_VERSION, type ServerMsg, WS_PATH } from "../shared/protocol.ts";
import { LIMITS, RateLimiter, WindowCounter } from "./limits.ts";
import { errorFields, log } from "./log.ts";
import { type Conn, RoomManager } from "./rooms.ts";
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
/** Fel från webbläsare: högst så här många per IP och minut, så att loggen inte kan översvämmas. */
const clientErrors = new WindowCounter(LIMITS.clientErrorsPerMinute, 60_000);
const connectionsPerIp = new Map<string, number>();
let shuttingDown = false;

// Säkerhetsheaders för spelsidan. Ligger klienten på en annan domän än servern: lägg till den i connect-src.
const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "media-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

/** Tillåtna sidor som får öppna WebSocket mot servern (kommaseparerat). Tomt = alla. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
/** Lita på X-Forwarded-For (sätt TRUST_PROXY=0 om servern nås direkt utan proxy framför). */
const TRUST_PROXY = process.env.TRUST_PROXY !== "0";

const http = createServer((req, res) => {
  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  } catch {
    // Felaktig URL-kodning (t.ex. "/%E0%A4%A") får inte krascha servern.
    res.writeHead(400);
    return res.end();
  }
  if (path === "/health") {
    res.writeHead(shuttingDown ? 503 : 200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: !shuttingDown, rooms: rooms.roomCount, version: PROTOCOL_VERSION }));
  }
  if (path === LOG_PATH && req.method === "POST") return receiveClientError(req, res);
  if (!existsSync(DIST)) {
    res.writeHead(404);
    return res.end("Klienten är inte byggd. Kör `pnpm dev` (utveckling) eller `pnpm build` först.");
  }
  // Statiska filer, annars index.html så att länkar som /r/ABCD fungerar.
  let file = join(DIST, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "cache-control": file.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(file)
    .on("error", () => res.destroy())
    .pipe(res);
});

const wss = new WebSocketServer({
  server: http,
  path: WS_PATH,
  maxPayload: 4096,
  // Stoppa andra webbplatser från att ansluta till din server, om ALLOWED_ORIGINS är satt.
  verifyClient: ({ origin }: { origin: string }) => ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin),
});
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
  // Överskott räknas per tiosekundersfönster, så att enstaka toppar under en lång session
  // inte till slut kopplar bort en vanlig spelare. Den som spammar oavbrutet kopplas bort.
  let dropped = 0;
  let dropWindowStart = Date.now();

  ws.on("message", (data) => {
    if (!limiter.take()) {
      const now = Date.now();
      if (now - dropWindowStart > 10_000) {
        dropWindowStart = now;
        dropped = 0;
      }
      if (++dropped > LIMITS.msgBurst * 2) {
        log.warn("rate_limited", { ip });
        ws.close(1008, "rate limited");
      }
      return;
    }
    const msg = parseClientMsg(String(data));
    if (!msg) return send({ t: "error", code: "bad_request", message: "Ogiltigt meddelande." });
    try {
      rooms.handle(conn, msg);
    } catch (err) {
      // Ett fel i ett meddelande ska inte krascha servern och alla andras rum.
      log.error("handle_failed", { t: msg.t, ...errorFields(err) });
      send({ t: "error", code: "internal", message: "Något gick fel på servern." });
    }
  });
  ws.on("close", () => {
    const left = (connectionsPerIp.get(ip) ?? 1) - 1;
    if (left > 0) connectionsPerIp.set(ip, left);
    else connectionsPerIp.delete(ip);
    rooms.disconnected(conn);
  });
});

/** Tar emot ett fel från en spelares webbläsare och skriver det i serverns logg. */
function receiveClientError(req: IncomingMessage, res: ServerResponse): void {
  const done = (status: number) => {
    res.writeHead(status);
    res.end();
  };
  if (!clientErrors.allow(clientIp(req))) {
    clientErrors.prune();
    req.resume();
    done(429);
    return;
  }
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk: string) => {
    body += chunk;
    if (body.length > 4096) req.destroy();
  });
  req.on("end", () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return done(400);
    }
    const result = v.safeParse(ClientErrorSchema, parsed);
    if (!result.success) return done(400);
    log.warn("client_error", { ...result.output, ua: String(req.headers["user-agent"] ?? "").slice(0, 200) });
    done(204);
  });
}

/** Bakom en proxy (Fly, Render, Railway) är klientens adress den sista i X-Forwarded-For. */
function clientIp(req: IncomingMessage): string {
  if (!TRUST_PROXY) return req.socket.remoteAddress || "?";
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
  log.info("shutdown", { signal, rooms: rooms.roomCount });
  clearInterval(heartbeat);
  rooms.shutdown();
  for (const ws of wss.clients) ws.close(1012, "server restart");
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Ett oväntat fel: logga det med stack så att det går att felsöka, och starta om processen
// (hostens omstart ger ett rent läge; ett halvtrasigt tillstånd är värre).
process.on("uncaughtException", (err) => {
  log.error("uncaught_exception", errorFields(err));
  process.exit(1);
});
process.on("unhandledRejection", (err) => log.error("unhandled_rejection", errorFields(err)));

http.listen(PORT, () =>
  log.info("listening", { url: `http://localhost:${PORT}`, ws: WS_PATH, version: PROTOCOL_VERSION }),
);
