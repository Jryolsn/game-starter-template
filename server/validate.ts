// Kontrollerar formen på allt som kommer från klienten innan det når rummen.
// Spelspecifika värden (t.ex. innehållet i `input`) valideras vidare i game.applyInput.
import type { PlayerInput } from "../shared/game.ts";
import type { ClientMsg, Resume } from "../shared/protocol.ts";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

export function parseClientMsg(raw: string): ClientMsg | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(m)) return null;
  switch (m.t) {
    case "create":
      return isStr(m.name, 64) ? { t: "create", name: m.name } : null;
    case "join": {
      if (!isStr(m.code, 16) || !isStr(m.name, 64)) return null;
      const resume = parseResume(m.resume);
      if (resume === null) return null;
      return { t: "join", code: m.code, name: m.name, ...(resume && { resume }) };
    }
    case "input":
      return isObj(m.input) ? { t: "input", input: m.input as unknown as PlayerInput } : null;
    case "start":
    case "leave":
      return { t: m.t };
    default:
      return null;
  }
}

/** undefined = ingen resume skickad, null = ogiltig. */
function parseResume(v: unknown): Resume | undefined | null {
  if (v === undefined) return undefined;
  if (!isObj(v) || !isStr(v.playerId, 64) || !isStr(v.secret, 64)) return null;
  return { playerId: v.playerId, secret: v.secret };
}
