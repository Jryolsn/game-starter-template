// Meddelanden mellan klient och server. Allt är JSON över en WebSocket.
// Klientens meddelanden beskrivs som Valibot-scheman: de ger både TypeScript-typerna och valideringen på servern.
import * as v from "valibot";
import { type GameState, PlayerInputSchema } from "./game.ts";

export interface LobbyPlayer {
  id: string;
  name: string;
  color: string;
  connected: boolean;
}

export type RoomPhase = "lobby" | "playing" | "finished";

const ResumeSchema = v.object({
  playerId: v.pipe(v.string(), v.maxLength(64)),
  secret: v.pipe(v.string(), v.maxLength(64)),
});

const NameSchema = v.pipe(v.string(), v.maxLength(64));

export const ClientMsgSchema = v.variant("t", [
  v.object({ t: v.literal("create"), name: NameSchema }),
  v.object({
    t: v.literal("join"),
    code: v.pipe(v.string(), v.maxLength(16)),
    name: NameSchema,
    resume: v.optional(ResumeSchema),
  }),
  v.object({ t: v.literal("start") }),
  v.object({ t: v.literal("input"), input: PlayerInputSchema }),
  v.object({ t: v.literal("leave") }),
]);

export type ClientMsg = v.InferOutput<typeof ClientMsgSchema>;

export type ServerMsg =
  | { t: "joined"; code: string; you: string; resume: Resume }
  | { t: "lobby"; players: LobbyPlayer[]; hostId: string; phase: RoomPhase }
  | { t: "state"; state: GameState }
  | { t: "error"; code: ErrorCode; message: string };

/** Hemlighet som låter en spelare återansluta till sin plats (t.ex. efter att mobilen låst skärmen). */
export type Resume = v.InferOutput<typeof ResumeSchema>;

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
