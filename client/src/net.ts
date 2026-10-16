// Två sätt att prata med "servern" med exakt samma gränssnitt:
//  - OnlineConnection: riktig WebSocket mot Node-servern (multiplayer).
//  - SoloConnection: en liten server som kör i webbläsaren (spela själv, funkar offline).
// Resten av klienten vet inte vilken som används.
import * as game from "../../shared/game.ts";
import {
  type ClientMsg,
  PROTOCOL_VERSION,
  type Resume,
  type ServerMsg,
  TICK_HZ,
  WS_PATH,
} from "../../shared/protocol.ts";

export interface Connection {
  send(msg: ClientMsg): void;
  onMessage(cb: (msg: ServerMsg) => void): void;
  onStatus(cb: (online: boolean) => void): void;
  close(): void;
}

const RESUME_KEY = "spelet.resume";

export class OnlineConnection implements Connection {
  private ws?: WebSocket;
  private queue: ClientMsg[] = [];
  private listeners: ((msg: ServerMsg) => void)[] = [];
  private statusListeners: ((online: boolean) => void)[] = [];
  private closed = false;
  private retry = 0;
  /** Senaste rummet vi var med i, för att automatiskt återansluta. */
  private room?: { code: string; name: string; color?: game.PlayerColor };

  constructor(private url = defaultWsUrl()) {
    this.connect();
  }

  send(msg: ClientMsg): void {
    if (msg.t === "join") {
      this.room = { code: msg.code, name: msg.name, color: msg.color };
      msg = { ...msg, resume: msg.resume ?? loadResume(msg.code) };
    }
    if (msg.t === "create") this.room = { code: "", name: msg.name, color: msg.color };
    if (msg.t === "profile" && this.room) {
      this.room = { ...this.room, name: msg.name ?? this.room.name, color: msg.color ?? this.room.color };
    }
    if (msg.t === "leave") {
      this.room = undefined;
      try {
        sessionStorage.removeItem(RESUME_KEY);
      } catch {}
    }
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (msg.t !== "input") this.queue.push(msg);
  }

  onMessage(cb: (msg: ServerMsg) => void): void {
    this.listeners.push(cb);
  }

  onStatus(cb: (online: boolean) => void): void {
    this.statusListeners.push(cb);
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  private connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      for (const cb of this.statusListeners) cb(true);
      // Efter ett avbrott: gå tillbaka in på samma plats i rummet.
      const queued = this.queue.splice(0);
      if (this.room?.code && !queued.some((m) => m.t === "join" || m.t === "create")) {
        ws.send(JSON.stringify({ t: "join", ...this.room, resume: loadResume(this.room.code) } satisfies ClientMsg));
      }
      for (const m of queued) ws.send(JSON.stringify(m));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ServerMsg;
      if (msg.t === "joined") {
        this.room = { code: msg.code, name: this.room?.name ?? "", color: this.room?.color };
        try {
          sessionStorage.setItem(RESUME_KEY, JSON.stringify({ code: msg.code, ...msg.resume }));
        } catch {}
      }
      if (msg.t === "error" && ["not_found", "full", "server_restart"].includes(msg.code)) this.room = undefined;
      if (msg.t === "error" && msg.code === "outdated") this.closed = true; // återanslut inte, sidan måste laddas om
      for (const cb of this.listeners) cb(msg);
    };
    ws.onclose = () => {
      if (this.closed) return;
      for (const cb of this.statusListeners) cb(false);
      const delay = Math.min(5000, 300 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }
}

/** Sparad återanslutningsnyckel för ett rum (överlever omladdning av fliken). */
export function loadResume(code: string): Resume | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem(RESUME_KEY) ?? "null");
    if (saved?.code === code) return { playerId: saved.playerId, secret: saved.secret };
  } catch {}
  return undefined;
}

function defaultWsUrl(): string {
  const env = import.meta.env.VITE_WS_URL as string | undefined; // sätt om servern ligger på en annan domän
  const base = env || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${WS_PATH}`;
  return `${base}${base.includes("?") ? "&" : "?"}v=${PROTOCOL_VERSION}`;
}

/** Spela själv: samma spellogik och samma meddelanden, men allt körs lokalt. */
export class SoloConnection implements Connection {
  private listeners: ((msg: ServerMsg) => void)[] = [];
  private state?: game.GameState;
  private loop?: number;
  private readonly me = "solo";

  constructor(
    private name: string,
    private color: game.PlayerColor = game.PLAYER_COLORS[0],
  ) {}

  send(msg: ClientMsg): void {
    switch (msg.t) {
      case "create":
        this.emit({ t: "joined", code: "SOLO", you: this.me, resume: { playerId: this.me, secret: "" } });
        this.emit(this.lobby("lobby"));
        break;
      case "start":
        clearInterval(this.loop);
        this.state = game.createGame([{ id: this.me, name: this.name, color: this.color }]);
        this.emit(this.lobby("playing"));
        this.loop = window.setInterval(() => this.step(), 1000 / TICK_HZ);
        break;
      case "input":
        if (this.state) game.applyInput(this.state, this.me, msg.input);
        break;
      case "leave":
        this.close();
        break;
    }
  }

  onMessage(cb: (msg: ServerMsg) => void): void {
    this.listeners.push(cb);
  }

  onStatus(): void {}

  close(): void {
    clearInterval(this.loop);
  }

  private step(): void {
    const state = this.state!;
    game.tick(state, 1 / TICK_HZ);
    this.emit({ t: "state", state: structuredClone(state) });
    if (state.over) {
      clearInterval(this.loop);
      this.emit(this.lobby("finished"));
    }
  }

  private lobby(phase: "lobby" | "playing" | "finished"): ServerMsg {
    return {
      t: "lobby",
      hostId: this.me,
      phase,
      players: [{ id: this.me, name: this.name, color: this.color, connected: true }],
    };
  }

  private emit(msg: ServerMsg): void {
    // Asynkront, precis som ett riktigt nätverk, så att klientkoden beter sig likadant.
    queueMicrotask(() => {
      for (const cb of this.listeners) cb(msg);
    });
  }
}
