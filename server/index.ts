// HTTP + WebSocket-server. I produktion serverar den även den byggda klienten (dist/),
// så hela spelet kan driftas som en enda Node-process.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { WS_PATH, type ClientMsg, type ServerMsg } from "../shared/protocol.ts";
import { RoomManager, type Conn } from "./rooms.ts";

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

const http = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  if (path === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.roomCount }));
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

wss.on("connection", (ws) => {
  alive.add(ws);
  ws.on("pong", () => alive.add(ws));
  const conn: Conn = {
    send: (msg: ServerMsg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg)),
  };
  ws.on("message", (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return conn.send({ t: "error", code: "bad_request", message: "Ogiltigt meddelande." });
    }
    if (msg && typeof msg === "object" && typeof msg.t === "string") rooms.handle(conn, msg);
  });
  ws.on("close", () => rooms.disconnected(conn));
});

// Stäng döda anslutningar (t.ex. mobiler som tappat nätet utan att säga hejdå).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, 15_000);

http.listen(PORT, () => console.log(`Servern lyssnar på http://localhost:${PORT} (WebSocket ${WS_PATH})`));
