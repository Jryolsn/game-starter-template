// Rumshantering i minnet. Servern är auktoritativ: den kör spellogiken och skickar ut tillståndet.
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import * as game from "../shared/game.ts";
import { generateRoomCode, normalizeRoomCode } from "../shared/roomCode.ts";
import { LIMITS, WindowCounter } from "./limits.ts";
import { MAX_PLAYERS, TICK_HZ, type ClientMsg, type ErrorCode, type RoomPhase, type ServerMsg } from "../shared/protocol.ts";

/** Det servern behöver från en anslutning. Gör rummen testbara utan riktiga sockets. */
export interface Conn {
  send(msg: ServerMsg): void;
  /** Klientens IP-adress, för gränser per avsändare. */
  ip?: string;
}

interface Player {
  id: string;
  name: string;
  color: string;
  secret: string;
  conn: Conn | null;
  dropTimer?: NodeJS.Timeout;
}

interface Room {
  code: string;
  players: Map<string, Player>;
  hostId: string;
  phase: RoomPhase;
  state: game.GameState | null;
  loop?: NodeJS.Timeout;
}

/** Hur länge en frånkopplad spelare behåller sin plats (mobiler tappar ofta anslutningen). */
export const RECONNECT_GRACE_MS = 30_000;

export class RoomManager {
  private rooms = new Map<string, Room>();
  private where = new Map<Conn, { room: Room; player: Player }>();
  private creates: WindowCounter;
  private failedJoins: WindowCounter;
  private maxRooms: number;

  constructor(opts: { maxRooms?: number; roomsPerMinute?: number; failedJoinsPerMinute?: number } = {}) {
    this.maxRooms = opts.maxRooms ?? LIMITS.maxRooms;
    this.creates = new WindowCounter(opts.roomsPerMinute ?? LIMITS.roomsPerMinute, 60_000);
    this.failedJoins = new WindowCounter(opts.failedJoinsPerMinute ?? LIMITS.failedJoinsPerMinute, 60_000);
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  handle(conn: Conn, msg: ClientMsg): void {
    switch (msg.t) {
      case "create":
        return this.create(conn, msg.name);
      case "join":
        return this.join(conn, msg.code, msg.name, msg.resume);
      case "start":
        return this.start(conn);
      case "input": {
        const at = this.where.get(conn);
        if (at?.room.state) game.applyInput(at.room.state, at.player.id, msg.input);
        return;
      }
      case "leave":
        return this.leave(conn);
    }
  }

  /** Anropas när socketen stängs. Spelaren får en stund på sig att återansluta. */
  disconnected(conn: Conn): void {
    const at = this.where.get(conn);
    if (!at) return;
    this.where.delete(conn);
    const { room, player } = at;
    player.conn = null;
    player.dropTimer = setTimeout(() => this.removePlayer(room, player), RECONNECT_GRACE_MS);
    this.broadcastLobby(room);
  }

  /** Vid omstart: berätta för alla att servern försvinner och stoppa alla spelloopar. */
  shutdown(): void {
    for (const room of this.rooms.values()) {
      clearInterval(room.loop);
      for (const p of room.players.values()) clearTimeout(p.dropTimer);
      this.broadcast(room, { t: "error", code: "server_restart", message: "Servern startas om. Rummet stängs." });
    }
    this.rooms.clear();
    this.where.clear();
  }

  private create(conn: Conn, name: string): void {
    if (this.rooms.size >= this.maxRooms) {
      return this.error(conn, "too_many_rooms", "Servern är full just nu. Försök igen om en stund.");
    }
    if (!this.creates.allow(conn.ip ?? "?")) {
      return this.error(conn, "rate_limited", "Du har skapat många rum på kort tid. Vänta en minut.");
    }
    this.creates.prune();
    this.leave(conn);
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();
    const room: Room = { code, players: new Map(), hostId: "", phase: "lobby", state: null };
    this.rooms.set(code, room);
    const player = this.addPlayer(room, conn, name);
    room.hostId = player.id;
    this.broadcastLobby(room);
  }

  private join(conn: Conn, rawCode: string, name: string, resume?: { playerId: string; secret: string }): void {
    const ip = conn.ip ?? "?";
    // Koderna är korta, så begränsa felgissningar för att ingen ska kunna leta upp andras rum.
    if (this.failedJoins.isBlocked(ip)) {
      return this.error(conn, "rate_limited", "För många felaktiga koder. Vänta en minut.");
    }
    const code = normalizeRoomCode(String(rawCode ?? ""));
    const room = code ? this.rooms.get(code) : undefined;
    if (!room) {
      this.failedJoins.allow(ip);
      this.failedJoins.prune();
      return this.error(conn, "not_found", "Hittade inget rum med den koden.");
    }
    this.leave(conn);

    const old = resume && room.players.get(resume.playerId);
    if (old && safeEqual(old.secret, resume.secret)) {
      clearTimeout(old.dropTimer);
      if (old.conn) this.where.delete(old.conn);
      old.conn = conn;
      this.where.set(conn, { room, player: old });
      conn.send({ t: "joined", code: room.code, you: old.id, resume: { playerId: old.id, secret: old.secret } });
      this.broadcastLobby(room);
      if (room.state) conn.send({ t: "state", state: room.state });
      return;
    }

    if (room.players.size >= MAX_PLAYERS) return this.error(conn, "full", "Rummet är fullt.");
    const player = this.addPlayer(room, conn, name);
    // Sena spelare hoppar in direkt i en pågående runda.
    if (room.state && room.phase === "playing") game.addPlayer(room.state, player);
    this.broadcastLobby(room);
  }

  private start(conn: Conn): void {
    const at = this.where.get(conn);
    if (!at) return;
    const { room, player } = at;
    if (room.hostId !== player.id) return this.error(conn, "not_host", "Bara värden kan starta.");
    if (room.phase === "playing") return;
    room.state = game.createGame([...room.players.values()]);
    room.phase = "playing";
    this.broadcastLobby(room);
    const dt = 1 / TICK_HZ;
    room.loop = setInterval(() => {
      const state = room.state!;
      game.tick(state, dt);
      this.broadcast(room, { t: "state", state });
      if (state.over) {
        clearInterval(room.loop);
        room.phase = "finished";
        this.broadcastLobby(room);
      }
    }, 1000 / TICK_HZ);
  }

  private leave(conn: Conn): void {
    const at = this.where.get(conn);
    if (!at) return;
    this.where.delete(conn);
    this.removePlayer(at.room, at.player);
  }

  private addPlayer(room: Room, conn: Conn, rawName: string): Player {
    const used = new Set([...room.players.values()].map((p) => p.color));
    const player: Player = {
      id: randomUUID(),
      name: cleanName(rawName, room.players.size + 1),
      color: game.PLAYER_COLORS.find((c) => !used.has(c)) ?? game.PLAYER_COLORS[0],
      secret: randomBytes(16).toString("hex"),
      conn,
    };
    room.players.set(player.id, player);
    this.where.set(conn, { room, player });
    conn.send({ t: "joined", code: room.code, you: player.id, resume: { playerId: player.id, secret: player.secret } });
    return player;
  }

  private removePlayer(room: Room, player: Player): void {
    clearTimeout(player.dropTimer);
    if (room.players.get(player.id) !== player) return;
    room.players.delete(player.id);
    if (room.state) game.removePlayer(room.state, player.id);
    if (room.players.size === 0) {
      clearInterval(room.loop);
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostId === player.id) {
      const next = [...room.players.values()].find((p) => p.conn) ?? room.players.values().next().value!;
      room.hostId = next.id;
    }
    this.broadcastLobby(room);
  }

  private broadcastLobby(room: Room): void {
    this.broadcast(room, {
      t: "lobby",
      hostId: room.hostId,
      phase: room.phase,
      players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, connected: !!p.conn })),
    });
  }

  private broadcast(room: Room, msg: ServerMsg): void {
    for (const p of room.players.values()) p.conn?.send(msg);
  }

  private error(conn: Conn, code: ErrorCode, message: string): void {
    conn.send({ t: "error", code, message });
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cleanName(name: unknown, n: number): string {
  const s = String(name ?? "")
    .replace(/[\p{Cc}\p{Cf}]/gu, "") // kontrolltecken och osynliga tecken (t.ex. riktningsbyten som vänder text)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
  return s || `Spelare ${n}`;
}
