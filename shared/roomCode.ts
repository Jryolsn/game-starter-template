// Rumskoder: korta, lätta att läsa upp och skriva på mobil.
// Inga förväxlingsbara tecken (0/O, 1/I/L).
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 4;

export function generateRoomCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Gör om användarinmatning till en giltig kod, eller null. Tolererar gemener, mellanslag och bindestreck. */
export function normalizeRoomCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, "");
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const ch of cleaned) if (!CODE_ALPHABET.includes(ch)) return null;
  return cleaned;
}

/**
 * Länken som delas: https://example.com/r/ABCD#k=<inbjudningsnyckel>
 * Nyckeln ligger efter # så att den aldrig skickas till servern i HTTP-anrop eller syns i loggar.
 * Med nyckeln slipper man rummets lösenord; utan den räcker koden för rum utan lösenord.
 */
export function roomLink(origin: string, code: string, invite?: string): string {
  return `${origin}/r/${code}${invite ? `#k=${encodeURIComponent(invite)}` : ""}`;
}

/** Läser inbjudningsnyckeln från länken (#k=...), om den finns. */
export function inviteFromUrl(url: URL): string | undefined {
  const k = new URLSearchParams(url.hash.slice(1)).get("k");
  return k && k.length <= 64 ? k : undefined;
}

/** Läser rumskod från en URL: stöder både /r/ABCD och ?room=ABCD. */
export function roomCodeFromUrl(url: URL): string | null {
  const m = url.pathname.match(/^\/r\/([^/]+)\/?$/);
  const raw = m?.[1] ?? url.searchParams.get("room");
  return raw ? normalizeRoomCode(decodeURIComponent(raw)) : null;
}
