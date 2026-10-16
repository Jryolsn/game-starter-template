import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { ServerMsg } from "../shared/protocol.ts";
import { RoomManager, type Conn } from "./rooms.ts";

function client() {
  const inbox: ServerMsg[] = [];
  const conn: Conn = { send: (m) => inbox.push(m) };
  const last = <T extends ServerMsg["t"]>(t: T) => inbox.filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }>;
  return { conn, inbox, last };
}

let rooms: RoomManager;
afterEach(() => {
  // städa intervall/timers så att testprocessen avslutas
  for (const c of cleanup) rooms.handle(c, { t: "leave" });
  cleanup.length = 0;
});
const cleanup: Conn[] = [];

test("skapa rum och gå med via kod", () => {
  rooms = new RoomManager();
  const a = client();
  const b = client();
  cleanup.push(a.conn, b.conn);
  rooms.handle(a.conn, { t: "create", name: "Anna" });
  const code = a.last("joined").code;
  rooms.handle(b.conn, { t: "join", code: code.toLowerCase(), name: "Bo" });
  assert.equal(b.last("joined").code, code);
  const lobby = a.last("lobby");
  assert.deepEqual(lobby.players.map((p) => p.name), ["Anna", "Bo"]);
  assert.equal(lobby.hostId, a.last("joined").you);
});

test("fel kod ger not_found", () => {
  rooms = new RoomManager();
  const a = client();
  rooms.handle(a.conn, { t: "join", code: "ZZZZ", name: "X" });
  assert.equal(a.last("error").code, "not_found");
});

test("bara värden kan starta, och värdskapet går vidare när värden lämnar", () => {
  rooms = new RoomManager();
  const a = client();
  const b = client();
  cleanup.push(b.conn);
  rooms.handle(a.conn, { t: "create", name: "A" });
  rooms.handle(b.conn, { t: "join", code: a.last("joined").code, name: "B" });
  rooms.handle(b.conn, { t: "start" });
  assert.equal(b.last("error").code, "not_host");
  rooms.handle(a.conn, { t: "leave" });
  assert.equal(b.last("lobby").hostId, b.last("joined").you);
});

test("återanslutning med resume behåller platsen", () => {
  rooms = new RoomManager();
  const a = client();
  rooms.handle(a.conn, { t: "create", name: "A" });
  const joined = a.last("joined");
  rooms.disconnected(a.conn);
  const a2 = client();
  cleanup.push(a2.conn);
  rooms.handle(a2.conn, { t: "join", code: joined.code, name: "A", resume: joined.resume });
  assert.equal(a2.last("joined").you, joined.you);
  assert.equal(a2.last("lobby").players.length, 1);
  assert.ok(a2.last("lobby").players[0].connected);
});

test("tomt rum tas bort", () => {
  rooms = new RoomManager();
  const a = client();
  rooms.handle(a.conn, { t: "create", name: "A" });
  rooms.handle(a.conn, { t: "leave" });
  assert.equal(rooms.roomCount, 0);
});

test("för många rum från samma IP stoppas", () => {
  rooms = new RoomManager({ roomsPerMinute: 2 });
  const a = client();
  const conn = { ...a.conn, ip: "1.2.3.4" };
  cleanup.push(conn);
  rooms.handle(conn, { t: "create", name: "A" });
  rooms.handle(conn, { t: "create", name: "A" });
  rooms.handle(conn, { t: "create", name: "A" });
  assert.equal(a.last("error").code, "rate_limited");
  assert.equal(rooms.roomCount, 1); // att skapa ett nytt rum lämnar det förra
});

test("servern har ett tak för antal rum", () => {
  rooms = new RoomManager({ maxRooms: 1 });
  const a = client();
  const b = client();
  cleanup.push(a.conn);
  rooms.handle(a.conn, { t: "create", name: "A" });
  rooms.handle(b.conn, { t: "create", name: "B" });
  assert.equal(b.last("error").code, "too_many_rooms");
});

test("shutdown meddelar spelarna och tömmer rummen", () => {
  rooms = new RoomManager();
  const a = client();
  rooms.handle(a.conn, { t: "create", name: "A" });
  rooms.handle(a.conn, { t: "start" });
  rooms.shutdown();
  assert.equal(a.last("error").code, "server_restart");
  assert.equal(rooms.roomCount, 0);
});

test("felgissade koder begränsas per IP", () => {
  rooms = new RoomManager({ failedJoinsPerMinute: 3 });
  const a = client();
  const conn = { ...a.conn, ip: "5.6.7.8" };
  for (let i = 0; i < 3; i++) rooms.handle(conn, { t: "join", code: "ZZZZ", name: "X" });
  assert.equal(a.last("error").code, "not_found");
  rooms.handle(conn, { t: "join", code: "ZZZZ", name: "X" });
  assert.equal(a.last("error").code, "rate_limited");
});

test("namn rensas från kontrolltecken och riktningsbyten", () => {
  rooms = new RoomManager();
  const a = client();
  cleanup.push(a.conn);
  rooms.handle(a.conn, { t: "create", name: "‮abc\u0000 def" });
  assert.equal(a.last("lobby").players[0].name, "abc def");
});
