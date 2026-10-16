// Spelarens profil och inställningar, sparade i webbläsaren (localStorage).
// Profilen skickas till servern när man går med i ett rum; inställningarna stannar på enheten.
import { PLAYER_COLORS, type PlayerColor } from "../../shared/game.ts";

export interface Profile {
  name: string;
  /** Önskad färg. Är den upptagen i rummet får man en ledig. */
  color?: PlayerColor;
}

export interface Settings {
  sound: boolean;
  vibration: boolean;
}

const PROFILE_KEY = "spelet.profile";
const SETTINGS_KEY = "spelet.settings";
const OLD_NAME_KEY = "spelet.name";

function read<T>(key: string): Partial<T> {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {}; // lagring kan vara blockerad (privat läge, inbäddad sida)
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function loadProfile(): Profile {
  const p = read<Profile>(PROFILE_KEY);
  let name = typeof p.name === "string" ? p.name : "";
  if (!name) {
    try {
      name = localStorage.getItem(OLD_NAME_KEY) ?? "";
    } catch {}
  }
  const color = PLAYER_COLORS.find((c) => c === p.color);
  return { name, color };
}

export function saveProfile(update: Partial<Profile>): Profile {
  const next = { ...loadProfile(), ...update };
  next.name = next.name.trim();
  write(PROFILE_KEY, next);
  return next;
}

export function loadSettings(): Settings {
  const s = read<Settings>(SETTINGS_KEY);
  return { sound: s.sound !== false, vibration: s.vibration !== false };
}

export function saveSettings(update: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...update };
  write(SETTINGS_KEY, next);
  return next;
}
