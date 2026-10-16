// Meddelanden mellan klient och server. Allt är JSON över en WebSocket.
// Klientens meddelanden beskrivs som Valibot-scheman: de ger både TypeScript-typerna och valideringen på servern.
import * as v from "valibot";
import { type GameState, PLAYER_COLORS, PlayerInputSchema } from "./game.ts";

export interface LobbyPlayer {
  id: string;
  name: string;
  color: string;
  connected: boolean;
}

export type RoomPhase = "lobby" | "playing" | "finished";
export type Visibility = "private" | "public";

/** Rummets inställningar som alla i rummet ser (själva lösenordet skickas aldrig ut). */
export interface RoomSettings {
  /** private: bara via kod, länk eller QR. public: syns i listan "Hitta rum". */
  visibility: Visibility;
  hasPassword: boolean;
  /** Låst: inga nya spelare, men de som redan är med kan återansluta. */
  locked: boolean;
}

/** Ett publikt rum i listan "Hitta rum". */
export interface PublicRoom {
  code: string;
  host: string;
  players: number;
  maxPlayers: number;
  phase: RoomPhase;
  hasPassword: boolean;
}

const ResumeSchema = v.object({
  playerId: v.pipe(v.string(), v.maxLength(64)),
  secret: v.pipe(v.string(), v.maxLength(64)),
});

const NameSchema = v.pipe(v.string(), v.maxLength(64));
const PasswordSchema = v.pipe(v.string(), v.maxLength(64));
const InviteSchema = v.pipe(v.string(), v.maxLength(64));
const ColorSchema = v.picklist(PLAYER_COLORS);

export const ClientMsgSchema = v.variant("t", [
  // color är spelarens önskade färg; är den upptagen i rummet får spelaren en ledig.
  v.object({ t: v.literal("create"), name: NameSchema, color: v.optional(ColorSchema) }),
  v.object({
    t: v.literal("join"),
    code: v.pipe(v.string(), v.maxLength(16)),
    name: NameSchema,
    color: v.optional(ColorSchema),
    resume: v.optional(ResumeSchema),
    /** Krävs om rummet har lösenord och man inte har en inbjudningsnyckel. */
    password: v.optional(PasswordSchema),
    /** Inbjudningsnyckeln från länken eller QR-koden. Släpper in utan lösenord. */
    invite: v.optional(InviteSchema),
  }),
  // Värden ändrar rummets inställningar. Tom sträng eller null tar bort lösenordet.
  v.object({
    t: v.literal("settings"),
    visibility: v.optional(v.picklist(["private", "public"])),
    password: v.optional(v.nullable(PasswordSchema)),
    locked: v.optional(v.boolean()),
  }),
  // Värden tar bort en spelare ur rummet.
  v.object({ t: v.literal("kick"), playerId: v.pipe(v.string(), v.maxLength(64)) }),
  // Hämta publika rum till listan "Hitta rum".
  v.object({ t: v.literal("list") }),
  // Byt namn och/eller färg (i lobbyn och på resultatskärmen, inte mitt i en runda).
  v.object({ t: v.literal("profile"), name: v.optional(NameSchema), color: v.optional(ColorSchema) }),
  v.object({ t: v.literal("start") }),
  v.object({ t: v.literal("input"), input: PlayerInputSchema }),
  v.object({ t: v.literal("leave") }),
]);

export type ClientMsg = v.InferOutput<typeof ClientMsgSchema>;

export type ServerMsg =
  | { t: "joined"; code: string; you: string; resume: Resume; invite: string }
  | { t: "lobby"; players: LobbyPlayer[]; hostId: string; phase: RoomPhase; settings: RoomSettings }
  | { t: "rooms"; rooms: PublicRoom[] }
  | { t: "state"; state: GameState }
  | { t: "error"; code: ErrorCode; message: string };

/** Hemlighet som låter en spelare återansluta till sin plats (t.ex. efter att mobilen låst skärmen). */
export type Resume = v.InferOutput<typeof ResumeSchema>;

export type ErrorCode =
  | "not_found"
  | "full"
  | "bad_request"
  | "not_host"
  | "color_taken"
  | "not_now"
  | "password_required"
  | "wrong_password"
  | "locked"
  | "kicked"
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
export const PROTOCOL_VERSION = 3;
