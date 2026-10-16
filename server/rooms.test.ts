import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import type { ServerMsg } from "../shared/protocol.ts";
import { type Conn, RoomManager } from "./rooms.ts";

function client() {
  const inbox: ServerMsg[] = [];
  const conn: Conn = { send: (m) => inbox.push(m) };
  const last = <T extends ServerMsg["t"]>(t: T) =>
    inbox.filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }>;
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
  assert.deepEqual(
    lobby.players.map((p) => p.name),
    ["Anna", "Bo"],
  );
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

test("önskad färg används om den är ledig, annars en ledig färg", () => {
  rooms = new RoomManager();
  const a = client();
  const b = client();
  cleanup.push(a.conn, b.conn);
  rooms.handle(a.conn, { t: "create", name: "A", color: "#06d6a0" });
  rooms.handle(b.conn, { t: "join", code: a.last("joined").code, name: "B", color: "#06d6a0" });
  const [pa, pb] = a.last("lobby").players;
  assert.equal(pa.color, "#06d6a0");
  assert.notEqual(pb.color, "#06d6a0");
});

test("profilbyte: namn och ledig färg i lobbyn, upptagen färg nekas", () => {
  rooms = new RoomManager();
  const a = client();
  const b = client();
  cleanup.push(a.conn, b.conn);
  rooms.handle(a.conn, { t: "create", name: "A" });
  rooms.handle(b.conn, { t: "join", code: a.last("joined").code, name: "B" });
  const colorA = a.last("lobby").players[0].color;
  rooms.handle(b.conn, { t: "profile", name: "Bosse", color: "#a3e635" });
  assert.deepEqual(
    a.last("lobby").players.map((p) => [p.name, p.color]),
    [
      ["A", colorA],
      ["Bosse", "#a3e635"],
    ],
  );
  rooms.handle(b.conn, { t: "profile", color: colorA as "#ff5d73" });
  assert.equal(b.last("error").code, "color_taken");
});

test("profilbyte nekas mitt i en runda", () => {
  rooms = new RoomManager();
  const a = client();
  cleanup.push(a.conn);
  rooms.handle(a.conn, { t: "create", name: "A" });
  rooms.handle(a.conn, { t: "start" });
  rooms.handle(a.conn, { t: "profile", name: "Ny" });
  assert.equal(a.last("error").code, "not_now");
});

function hostRoom(opts: ConstructorParameters<typeof RoomManager>[0] = {}) {
  rooms = new RoomManager(opts);
  const host = client();
  cleanup.push(host.conn);
  rooms.handle(host.conn, { t: "create", name: "Värd" });
  return { host, code: host.last("joined").code, invite: host.last("joined").invite };
}

test("publika rum syns i listan, privata och låsta gör det inte", () => {
  const { host, code } = hostRoom();
  const other = client();
  rooms.handle(other.conn, { t: "list" });
  assert.deepEqual(other.last("rooms").rooms, []);
  rooms.handle(host.conn, { t: "settings", visibility: "public" });
  rooms.handle(other.conn, { t: "list" });
  assert.deepEqual(
    other.last("rooms").rooms.map((r) => [r.code, r.host, r.hasPassword]),
    [[code, "Värd", false]],
  );
  rooms.handle(host.conn, { t: "settings", locked: true });
  rooms.handle(other.conn, { t: "list" });
  assert.deepEqual(other.last("rooms").rooms, []);
});

test("lösenord krävs via kod, men inte med inbjudningsnyckeln", () => {
  const { host, code, invite } = hostRoom();
  const secret = randomUUID();
  rooms.handle(host.conn, { t: "settings", password: secret });
  assert.equal(host.last("lobby").settings.hasPassword, true);

  const a = client();
  rooms.handle(a.conn, { t: "join", code, name: "A" });
  assert.equal(a.last("error").code, "password_required");
  rooms.handle(a.conn, { t: "join", code, name: "A", password: `${secret}x` });
  assert.equal(a.last("error").code, "wrong_password");
  rooms.handle(a.conn, { t: "join", code, name: "A", password: secret });
  assert.equal(a.last("joined").code, code);
  cleanup.push(a.conn);

  const b = client();
  cleanup.push(b.conn);
  rooms.handle(b.conn, { t: "join", code, name: "B", invite });
  assert.equal(b.last("joined").code, code);
});

test("låst rum släpper inte in nya men låter spelare återansluta", () => {
  const { host, code } = hostRoom();
  const a = client();
  rooms.handle(a.conn, { t: "join", code, name: "A" });
  const joined = a.last("joined");
  rooms.handle(host.conn, { t: "settings", locked: true });

  const b = client();
  rooms.handle(b.conn, { t: "join", code, name: "B" });
  assert.equal(b.last("error").code, "locked");

  rooms.disconnected(a.conn);
  const a2 = client();
  cleanup.push(a2.conn);
  rooms.handle(a2.conn, { t: "join", code, name: "A", resume: joined.resume });
  assert.equal(a2.last("joined").you, joined.you);
});

test("bara värden kan ändra rummets inställningar", () => {
  const { code } = hostRoom();
  const a = client();
  cleanup.push(a.conn);
  rooms.handle(a.conn, { t: "join", code, name: "A" });
  rooms.handle(a.conn, { t: "settings", visibility: "public" });
  assert.equal(a.last("error").code, "not_host");
});

test("värden kan ta bort en spelare, andra kan inte", () => {
  const { host, code } = hostRoom();
  const a = client();
  const b = client();
  cleanup.push(b.conn);
  rooms.handle(a.conn, { t: "join", code, name: "A" });
  rooms.handle(b.conn, { t: "join", code, name: "B" });
  const aId = a.last("joined").you;
  rooms.handle(b.conn, { t: "kick", playerId: aId });
  assert.equal(b.last("error").code, "not_host");

  rooms.handle(host.conn, { t: "kick", playerId: aId });
  assert.equal(a.last("error").code, "kicked");
  assert.deepEqual(
    host.last("lobby").players.map((p) => p.name),
    ["Värd", "B"],
  );
  // Den borttagna spelarens gamla nyckel fungerar inte längre.
  rooms.handle(host.conn, { t: "settings", locked: true });
  const a2 = client();
  rooms.handle(a2.conn, { t: "join", code, name: "A", resume: a.last("joined").resume });
  assert.equal(a2.last("error").code, "locked");
});
