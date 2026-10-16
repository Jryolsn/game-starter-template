// Exempelspelet "Prickjakt": styr din boll och plocka flest prickar innan tiden tar slut.
// Ren logik utan DOM eller nätverk, så samma kod kör på servern (multiplayer) och i webbläsaren (solo).
// Byt ut den här filen för att göra ett eget spel; behåll exporterna som mallen använder (se docs/nytt-spel.md).
import * as v from "valibot";

export const WORLD = { width: 90, height: 160 }; // stående format, mobile first
export const ROUND_SECONDS = 45;
const SPEED = 55; // enheter per sekund
const PLAYER_RADIUS = 4;
const COIN_RADIUS = 2.5;
const COIN_COUNT = 6;

/** Färgerna spelarna kan välja mellan. Lika många som MAX_PLAYERS, så att alla får en egen. */
export const PLAYER_COLORS = [
  "#ff5d73",
  "#4cc9f0",
  "#ffd166",
  "#06d6a0",
  "#b388ff",
  "#ff9f1c",
  "#f15bb5",
  "#a3e635",
] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];

/** Ett tal mellan -1 och 1. */
const axis = v.pipe(v.number(), v.finite(), v.minValue(-1), v.maxValue(1));

/**
 * Det klienten skickar som styrning. Servern validerar mot schemat innan det når applyInput,
 * så ändra schemat när ditt spel behöver annan input (knappar, sikte, val).
 */
export const PlayerInputSchema = v.object({
  /** Önskad riktning, längd 0..1. */
  x: axis,
  y: axis,
});
export type PlayerInput = v.InferOutput<typeof PlayerInputSchema>;

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  score: number;
  input: PlayerInput;
}

export interface Coin {
  id: number;
  x: number;
  y: number;
}

export interface GameState {
  players: Record<string, PlayerState>;
  coins: Coin[];
  timeLeft: number;
  over: boolean;
  nextCoinId: number;
  seed: number;
}

// Liten deterministisk slumpgenerator (mulberry32) så att tillståndet är reproducerbart.
export function rand(state: GameState): number {
  state.seed = (state.seed + 0x6d2b79f5) | 0;
  let t = state.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function spawnCoin(state: GameState): void {
  const m = 6;
  state.coins.push({
    id: state.nextCoinId++,
    x: m + rand(state) * (WORLD.width - 2 * m),
    y: m + rand(state) * (WORLD.height - 2 * m),
  });
}

export function createGame(players: { id: string; name: string; color: string }[], seed = Date.now()): GameState {
  const state: GameState = { players: {}, coins: [], timeLeft: ROUND_SECONDS, over: false, nextCoinId: 1, seed };
  for (const p of players) addPlayer(state, p);
  for (let i = 0; i < COIN_COUNT; i++) spawnCoin(state);
  return state;
}

export function addPlayer(state: GameState, p: { id: string; name: string; color: string }): void {
  if (state.players[p.id]) return;
  state.players[p.id] = {
    ...p,
    x: WORLD.width * (0.2 + 0.6 * rand(state)),
    y: WORLD.height * (0.2 + 0.6 * rand(state)),
    score: 0,
    input: { x: 0, y: 0 },
  };
}

export function removePlayer(state: GameState, id: string): void {
  delete state.players[id];
}

export function applyInput(state: GameState, id: string, input: PlayerInput): void {
  const p = state.players[id];
  if (!p) return;
  const len = Math.hypot(input.x, input.y);
  p.input = len > 1 ? { x: input.x / len, y: input.y / len } : { x: input.x, y: input.y };
}

export function tick(state: GameState, dt: number): void {
  if (state.over) return;
  state.timeLeft = Math.max(0, state.timeLeft - dt);
  for (const p of Object.values(state.players)) {
    p.x = clamp(p.x + p.input.x * SPEED * dt, PLAYER_RADIUS, WORLD.width - PLAYER_RADIUS);
    p.y = clamp(p.y + p.input.y * SPEED * dt, PLAYER_RADIUS, WORLD.height - PLAYER_RADIUS);
    for (let i = state.coins.length - 1; i >= 0; i--) {
      const c = state.coins[i];
      if (Math.hypot(c.x - p.x, c.y - p.y) < PLAYER_RADIUS + COIN_RADIUS) {
        state.coins.splice(i, 1);
        p.score++;
        spawnCoin(state);
      }
    }
  }
  if (state.timeLeft === 0) state.over = true;
}

export function ranking(state: GameState): PlayerState[] {
  return Object.values(state.players).sort((a, b) => b.score - a.score);
}

export const RADII = { player: PLAYER_RADIUS, coin: COIN_RADIUS };

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
