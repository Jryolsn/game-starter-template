// Meddelanden mellan klient och server. Allt är JSON över en WebSocket.
import type { GameState, PlayerInput } from "./game.ts";

export interface LobbyPlayer {
  id: string;
  name: string;
  color: string;
  connected: boolean;
}

export type RoomPhase = "lobby" | "playing" | "finished";

export type ClientMsg =
  | { t: "create"; name: string }
  | { t: "join"; code: string; name: string; resume?: Resume }
  | { t: "start" }
  | { t: "input"; input: PlayerInput }
  | { t: "leave" };

export type ServerMsg =
  | { t: "joined"; code: string; you: string; resume: Resume }
  | { t: "lobby"; players: LobbyPlayer[]; hostId: string; phase: RoomPhase }
  | { t: "state"; state: GameState }
  | { t: "error"; code: ErrorCode; message: string };

/** Hemlighet som låter en spelare återansluta till sin plats (t.ex. efter att mobilen låst skärmen). */
export interface Resume {
  playerId: string;
  secret: string;
}

export type ErrorCode =
  | "not_found"
  | "full"
  | "bad_request"
  | "not_host"
  | "rate_limited"
  | "too_many_rooms"
  | "outdated" // klienten kör en äldre version än servern och behöver laddas om
  | "server_restart";

export const MAX_PLAYERS = 8;
export const TICK_HZ = 20;
export const WS_PATH = "/ws";

/**
 * Höj när meddelandeformatet ändras på ett sätt som inte är bakåtkompatibelt.
 * Klienter med annan version blir ombedda att ladda om sidan efter en driftsättning.
 */
export const PROTOCOL_VERSION = 1;
