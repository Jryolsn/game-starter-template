// Meddelanden mellan klient och server. Allt är JSON över en WebSocket.
// Klientens meddelanden beskrivs som Valibot-scheman: de ger både TypeScript-typerna och valideringen på servern.
import * as v from "valibot";
import * as game from "../game/logic.ts";
import { type GameState, PLAYER_COLORS, PlayerInputSchema } from "../game/logic.ts";

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
  /** Spelets inställningar som värden valt (se GAME_SETTINGS). */
  game: GameSettings;
}

/**
 * En inställning som värden väljer i lobbyn, t.ex. rundans längd. Spelet exporterar sina som
 * `SETTINGS` i game/logic.ts; utan den finns inga spelinställningar.
 */
export interface GameSetting {
  key: string;
  label: string;
  options: readonly number[];
  default: number;
  /** Visas efter värdet, t.ex. "s". */
  unit?: string;
}
export type GameSettings = Record<string, number>;
export const GAME_SETTINGS: readonly GameSetting[] = (game as { SETTINGS?: readonly GameSetting[] }).SETTINGS ?? [];

export function defaultGameSettings(): GameSettings {
  return Object.fromEntries(GAME_SETTINGS.map((s) => [s.key, s.default]));
}

/** Bara värden som spelet erbjuder släpps igenom. */
const GameSettingsSchema = v.object(
  Object.fromEntries(GAME_SETTINGS.map((s) => [s.key, v.optional(v.picklist(s.options as number[]))])),
);

/** Startar en runda med värdens inställningar. Spel som inte har några inställningar ignorerar dem. */
export const startGame: (
  players: { id: string; name: string; color: string }[],
  seed: number | undefined,
  settings: GameSettings,
) => GameState = game.createGame;

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

/** Max antal tecken i ett chattmeddelande. */
export const CHAT_MAX_LENGTH = 200;

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
  // Värden ändrar rummets inställningar. Tom sträng eller null tar bort lösenordet. game: spelets inställningar.
  v.object({
    t: v.literal("settings"),
    visibility: v.optional(v.picklist(["private", "public"])),
    password: v.optional(v.nullable(PasswordSchema)),
    locked: v.optional(v.boolean()),
    game: v.optional(GameSettingsSchema),
  }),
  // Värden tar bort en spelare ur rummet.
  v.object({ t: v.literal("kick"), playerId: v.pipe(v.string(), v.maxLength(64)) }),
  // Hämta publika rum till listan "Hitta rum".
  v.object({ t: v.literal("list") }),
  // Byt namn och/eller färg (i lobbyn och på resultatskärmen, inte mitt i en runda).
  v.object({ t: v.literal("profile"), name: v.optional(NameSchema), color: v.optional(ColorSchema) }),
  v.object({ t: v.literal("start") }),
  v.object({ t: v.literal("input"), input: PlayerInputSchema }),
  // Chattmeddelande till alla i rummet, i lobbyn och under spelet.
  v.object({ t: v.literal("chat"), text: v.pipe(v.string(), v.maxLength(CHAT_MAX_LENGTH)) }),
  v.object({ t: v.literal("leave") }),
]);

export type ClientMsg = v.InferOutput<typeof ClientMsgSchema>;

/** Ett JavaScript-fel från en spelares webbläsare, skickas med POST till LOG_PATH. */
export const ClientErrorSchema = v.object({
  message: v.pipe(v.string(), v.maxLength(500)),
  stack: v.optional(v.pipe(v.string(), v.maxLength(2000))),
  /** Var i appen felet hände, t.ex. "/r/ABCD". */
  page: v.optional(v.pipe(v.string(), v.maxLength(200))),
  version: v.optional(v.number()),
});
export type ClientError = v.InferOutput<typeof ClientErrorSchema>;
export const LOG_PATH = "/log";

export type ServerMsg =
  | { t: "joined"; code: string; you: string; resume: Resume; invite: string }
  | { t: "lobby"; players: LobbyPlayer[]; hostId: string; phase: RoomPhase; settings: RoomSettings }
  | { t: "rooms"; rooms: PublicRoom[] }
  | { t: "state"; state: GameState }
  // Nya chattmeddelanden. history: de senaste i rummet, skickas när man går med eller återansluter.
  | { t: "chat"; messages: ChatMessage[]; history?: true }
  | { t: "error"; code: ErrorCode; message: string };

export interface ChatMessage {
  /** Ökar för varje meddelande i rummet, så att klienten kan hoppa över sådana den redan har. */
  id: number;
  from: string;
  /** Namn och färg när meddelandet skickades. */
  name: string;
  color: string;
  text: string;
}

/**
 * Det en spelare får se av tillståndet. Exporterar spelet `viewFor(state, playerId)` används den,
 * så att spelet kan dölja sådant spelaren inte ska veta (gömda spelare, andras kort). Annars ser alla allt.
 */
export function stateFor(state: GameState, playerId: string): GameState {
  const viewFor = (game as { viewFor?: (state: GameState, playerId: string) => GameState }).viewFor;
  return viewFor ? viewFor(state, playerId) : state;
}

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
  | "server_restart"
  | "internal"; // fel på servern, t.ex. en bugg i spellogiken

export const MAX_PLAYERS = 8;
export const TICK_HZ = 20;
export const WS_PATH = "/ws";

/**
 * Höj när meddelandeformatet ändras på ett sätt som inte är bakåtkompatibelt.
 * Klienter med annan version blir ombedda att ladda om sidan efter en driftsättning.
 */
export const PROTOCOL_VERSION = 5;
