// Skickar JavaScript-fel från spelarens webbläsare till servern, som skriver dem i sin logg.
// Utan det här syns ett fel som bara händer på någons mobil ingenstans.
import { type ClientError, LOG_PATH, PROTOCOL_VERSION } from "../../shared/protocol.ts";

const MAX_PER_PAGE = 5;
const sent = new Set<string>();

export function reportErrors(): void {
  window.addEventListener("error", (e) => report(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => report(e.reason));
}

export function report(err: unknown): void {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  // Samma fel i en loop ska bara skickas en gång.
  if (sent.has(message) || sent.size >= MAX_PER_PAGE) return;
  sent.add(message);
  const body: ClientError = {
    message,
    stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
    page: location.pathname.slice(0, 200),
    version: PROTOCOL_VERSION,
  };
  try {
    // sendBeacon fungerar även när sidan håller på att stängas.
    const blob = new Blob([JSON.stringify(body)], { type: "application/json" });
    if (!navigator.sendBeacon?.(LOG_PATH, blob)) {
      fetch(LOG_PATH, { method: "POST", body: JSON.stringify(body), keepalive: true }).catch(() => {});
    }
  } catch {}
}
