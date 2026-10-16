// Spelets delar av gränssnittet som mallen visar: texterna i HUD:en, resultatskärmen och feedback.
// Mallen (client/src/main.ts) anropar de här funktionerna; ändra dem för ditt spel.
import { playTone, vibrate } from "../client/src/device.ts";
import { type GameState, ranking } from "./logic.ts";

/** Texterna överst under spelet, från vänster. */
export function hud(state: GameState, me: string): string[] {
  return [`⏱ ${Math.ceil(state.timeLeft)}`, `● ${state.players[me]?.score ?? 0}`];
}

export interface ResultRow {
  name: string;
  color: string;
  /** Visas till höger, t.ex. poäng. */
  detail: string;
}

/** Rubrik och placeringar på resultatskärmen. */
export function results(state: GameState, solo: boolean): { title: string; rows: ResultRow[] } {
  const top = ranking(state);
  return {
    title: solo ? `${top[0]?.score ?? 0} prickar!` : `${top[0]?.name ?? "?"} vann!`,
    rows: top.map((p) => ({ name: p.name, color: p.color, detail: `${p.score} p` })),
  };
}

/** Anropas för varje nytt tillstånd. Exempel: vibrera och pip när du tar en prick. */
export function feedback(prev: GameState | null, next: GameState, me: string): void {
  if (prev && (next.players[me]?.score ?? 0) > (prev.players[me]?.score ?? 0)) {
    vibrate(20);
    playTone(880, 0.08);
  }
}
