// Rumshantering i minnet. Servern är auktoritativ: den kör spellogiken och skickar ut tillståndet.
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import * as game from "../game/logic.ts";
import {
  type ClientMsg,
  type ErrorCode,
  MAX_PLAYERS,
  type PublicRoom,
  type RoomPhase,
  type ServerMsg,
  TICK_HZ,
  type Visibility,
} from "../shared/protocol.ts";
import { generateRoomCode, normalizeRoomCode } from "../shared/roomCode.ts";
import { LIMITS, WindowCounter } from "./limits.ts";
import { errorFields, log } from "./log.ts";

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
  visibility: Visibility;
  /** Lösenordet i klartext, bara i minnet. null = inget lösenord. */
  password: string | null;
  locked: boolean;
  /** Hemlig nyckel i länken och QR-koden. Den som har den slipper lösenordet. */
  invite: string;
}

/** Max antal rum som skickas i listan "Hitta rum". */
const PUBLIC_LIST_LIMIT = 50;

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
        this.create(conn, msg.name, msg.color);
        break;
      case "join":
        this.join(conn, msg);
        break;
      case "settings":
        this.settings(conn, msg);
        break;
      case "kick":
        this.kick(conn, msg.playerId);
        break;
      case "list":
        conn.send({ t: "rooms", rooms: this.publicRooms() });
        break;
      case "profile":
        this.profile(conn, msg.name, msg.color);
        break;
      case "start":
        this.start(conn);
        break;
      case "input": {
        const at = this.where.get(conn);
        if (at?.room.state) game.applyInput(at.room.state, at.player.id, msg.input);
        break;
      }
      case "leave":
        this.leave(conn);
        break;
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

  private create(conn: Conn, name: string, color?: string): void {
    if (this.rooms.size >= this.maxRooms) {
      this.error(conn, "too_many_rooms", "Servern är full just nu. Försök igen om en stund.");
      return;
    }
    if (!this.creates.allow(conn.ip ?? "?")) {
      this.error(conn, "rate_limited", "Du har skapat många rum på kort tid. Vänta en minut.");
      return;
    }
    this.creates.prune();
    this.leave(conn);
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();
    const room: Room = {
      code,
      players: new Map(),
      hostId: "",
      phase: "lobby",
      state: null,
      visibility: "private",
      password: null,
      locked: false,
      invite: randomBytes(12).toString("base64url"),
    };
    this.rooms.set(code, room);
    log.info("room_created", { code, rooms: this.rooms.size });
    const player = this.addPlayer(room, conn, name, color);
    room.hostId = player.id;
    this.broadcastLobby(room);
  }

  private join(conn: Conn, msg: Extract<ClientMsg, { t: "join" }>): void {
    const { name, resume, color } = msg;
    const rawCode = msg.code;
    const ip = conn.ip ?? "?";
    // Koderna är korta, så begränsa felgissningar för att ingen ska kunna leta upp andras rum.
    if (this.failedJoins.isBlocked(ip)) {
      this.error(conn, "rate_limited", "För många felaktiga koder. Vänta en minut.");
      return;
    }
    const code = normalizeRoomCode(String(rawCode ?? ""));
    const room = code ? this.rooms.get(code) : undefined;
    if (!room) {
      this.failedJoins.allow(ip);
      this.failedJoins.prune();
      this.error(conn, "not_found", "Hittade inget rum med den koden.");
      return;
    }
    this.leave(conn);

    const old = resume && room.players.get(resume.playerId);
    if (old && safeEqual(old.secret, resume.secret)) {
      clearTimeout(old.dropTimer);
      if (old.conn) this.where.delete(old.conn);
      old.conn = conn;
      this.where.set(conn, { room, player: old });
      this.sendJoined(room, old);
      this.broadcastLobby(room);
      if (room.state) conn.send({ t: "state", state: room.state });
      return;
    }

    if (room.locked) {
      this.error(conn, "locked", "Rummet är låst av värden.");
      return;
    }
    // Lösenord krävs om man inte kommer via länken eller QR-koden (som bär inbjudningsnyckeln).
    const invited = msg.invite !== undefined && safeEqual(msg.invite, room.invite);
    if (room.password !== null && !invited) {
      if (msg.password === undefined) {
        this.error(conn, "password_required", "Rummet har lösenord.");
        return;
      }
      if (!safeEqual(msg.password, room.password)) {
        this.failedJoins.allow(ip);
        this.error(conn, "wrong_password", "Fel lösenord.");
        return;
      }
    }
    if (room.players.size >= MAX_PLAYERS) {
      this.error(conn, "full", "Rummet är fullt.");
      return;
    }
    const player = this.addPlayer(room, conn, name, color);
    // Sena spelare hoppar in direkt i en pågående runda.
    if (room.state && room.phase === "playing") game.addPlayer(room.state, player);
    this.broadcastLobby(room);
  }

  private start(conn: Conn): void {
    const at = this.where.get(conn);
    if (!at) return;
    const { room, player } = at;
    if (room.hostId !== player.id) {
      this.error(conn, "not_host", "Bara värden kan starta.");
      return;
    }
    if (room.phase === "playing") return;
    room.state = game.createGame([...room.players.values()]);
    room.phase = "playing";
    this.broadcastLobby(room);
    const dt = 1 / TICK_HZ;
    room.loop = setInterval(() => {
      const state = room.state!;
      try {
        game.tick(state, dt);
      } catch (err) {
        // En bugg i spellogiken ska bara stoppa det här rummets runda, inte hela servern.
        log.error("tick_failed", { code: room.code, ...errorFields(err) });
        clearInterval(room.loop);
        room.phase = "finished";
        this.broadcast(room, { t: "error", code: "internal", message: "Något gick fel i spelet. Rundan avbröts." });
        this.broadcastLobby(room);
        return;
      }
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

  /** Värden ändrar synlighet, lösenord och lås. */
  private settings(conn: Conn, msg: Extract<ClientMsg, { t: "settings" }>): void {
    const at = this.where.get(conn);
    if (!at) return;
    const { room, player } = at;
    if (room.hostId !== player.id) {
      this.error(conn, "not_host", "Bara värden kan ändra rummets inställningar.");
      return;
    }
    if (msg.visibility) room.visibility = msg.visibility;
    if (msg.password !== undefined) room.password = msg.password?.trim() || null;
    if (msg.locked !== undefined) room.locked = msg.locked;
    this.broadcastLobby(room);
  }

  /** Värden tar bort en spelare. Hen kan komma tillbaka om rummet inte är låst. */
  private kick(conn: Conn, playerId: string): void {
    const at = this.where.get(conn);
    if (!at) return;
    const { room, player } = at;
    if (room.hostId !== player.id) {
      this.error(conn, "not_host", "Bara värden kan ta bort spelare.");
      return;
    }
    const target = room.players.get(playerId);
    if (!target || target === player) return;
    if (target.conn) {
      this.where.delete(target.conn);
      this.error(target.conn, "kicked", "Värden tog bort dig från rummet.");
    }
    this.removePlayer(room, target);
  }

  /** Publika rum som går att gå med i just nu (inte låsta, inte fulla). */
  private publicRooms(): PublicRoom[] {
    const list: PublicRoom[] = [];
    for (const room of this.rooms.values()) {
      if (room.visibility !== "public" || room.locked || room.players.size >= MAX_PLAYERS) continue;
      list.push({
        code: room.code,
        host: room.players.get(room.hostId)?.name ?? "?",
        players: room.players.size,
        maxPlayers: MAX_PLAYERS,
        phase: room.phase,
        hasPassword: room.password !== null,
      });
      if (list.length >= PUBLIC_LIST_LIMIT) break;
    }
    return list;
  }

  /** Byt namn och/eller färg. Färgen måste vara ledig i rummet. */
  private profile(conn: Conn, name?: string, color?: string): void {
    const at = this.where.get(conn);
    if (!at) return;
    const { room, player } = at;
    if (room.phase === "playing") {
      this.error(conn, "not_now", "Det går inte att ändra mitt i en runda.");
      return;
    }
    if (color && color !== player.color) {
      if ([...room.players.values()].some((p) => p.color === color)) {
        this.error(conn, "color_taken", "Färgen är redan tagen.");
        return;
      }
      player.color = color;
    }
    if (name !== undefined) player.name = cleanName(name, [...room.players.keys()].indexOf(player.id) + 1);
    // Resultatskärmen visar namn och färg från spelets state, så uppdatera där också.
    const inGame = room.state?.players[player.id];
    if (inGame) Object.assign(inGame, { name: player.name, color: player.color });
    this.broadcastLobby(room);
  }

  private addPlayer(room: Room, conn: Conn, rawName: string, wanted?: string): Player {
    const used = new Set([...room.players.values()].map((p) => p.color));
    const free = game.PLAYER_COLORS.filter((c) => !used.has(c));
    const player: Player = {
      id: randomUUID(),
      name: cleanName(rawName, room.players.size + 1),
      color: free.find((c) => c === wanted) ?? free[0] ?? game.PLAYER_COLORS[0],
      secret: randomBytes(16).toString("hex"),
      conn,
    };
    room.players.set(player.id, player);
    this.where.set(conn, { room, player });
    this.sendJoined(room, player);
    return player;
  }

  private sendJoined(room: Room, player: Player): void {
    player.conn?.send({
      t: "joined",
      code: room.code,
      you: player.id,
      resume: { playerId: player.id, secret: player.secret },
      invite: room.invite,
    });
  }

  private removePlayer(room: Room, player: Player): void {
    clearTimeout(player.dropTimer);
    if (room.players.get(player.id) !== player) return;
    room.players.delete(player.id);
    if (room.state) game.removePlayer(room.state, player.id);
    if (room.players.size === 0) {
      clearInterval(room.loop);
      this.rooms.delete(room.code);
      log.info("room_closed", { code: room.code, rooms: this.rooms.size });
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
      settings: { visibility: room.visibility, hasPassword: room.password !== null, locked: room.locked },
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
