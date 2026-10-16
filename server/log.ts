// Loggning utan beroenden. I produktion blir varje rad ett JSON-objekt som loggtjänster
// (Fly, Render, Grafana, Datadog …) kan söka i. Under utveckling skrivs läsbar text.
//   log.info("room_created", { code: "ABCD" })
// LOG_LEVEL=debug|info|warn|error styr vad som skrivs (standard: info).

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const env = process.env.LOG_LEVEL as Level | undefined;
const MIN = ORDER[env && env in ORDER ? env : "info"];
const JSON_LINES = process.env.NODE_ENV === "production" || process.env.LOG_FORMAT === "json";

export type Fields = Record<string, unknown>;

function write(level: Level, event: string, fields: Fields = {}): void {
  if (ORDER[level] < MIN) return;
  const out = level === "error" || level === "warn" ? process.stderr : process.stdout;
  if (JSON_LINES) {
    out.write(`${JSON.stringify({ time: new Date().toISOString(), level, event, ...fields })}\n`);
    return;
  }
  const extra = Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  out.write(`[${level}] ${event}${extra ? ` ${extra}` : ""}\n`);
}

/** Gör ett fel loggbart (Error-objekt blir {} i JSON.stringify). */
export function errorFields(err: unknown): Fields {
  return err instanceof Error ? { error: err.message, stack: err.stack } : { error: String(err) };
}

export const log = {
  debug: (event: string, fields?: Fields) => write("debug", event, fields),
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};
